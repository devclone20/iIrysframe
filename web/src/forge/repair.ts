// Marketplace media repair.
//
// gateway.irys.xyz serves every tx behind a 302 redirect marked
// `cache-control: no-store` — marketplace media pipelines (OpenSea's crawler)
// refuse to cache that chain, so items show blank even though the data is
// perfect. The gateway's redirect TARGET is deterministic Irys CDN
// infrastructure that serves 200 + max-age=30d. Repair = re-seal the metadata
// with direct CDN media links (canonical gateway links kept alongside) and
// point the token's URI at it via setTokenURI — the owner can always re-point.

import { ethers } from "ethers";
import { GATEWAY, BASE, type Eip1193Provider } from "../config";

const CDN_SUFFIX = "mainnet-1.datasprite-cdn.com";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error(`invalid base58: ${c}`);
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  while (out.length < 32) out.unshift(0);
  return new Uint8Array(out);
}

function base32(bytes: Uint8Array): string {
  const A = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += A[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

/** Heuristic CDN URL for an Irys tx id — matches the gateway target for plain
 *  uploads, but NOT for all (chunked uploads map to a different internal id).
 *  Kept only as a fallback; prefer resolveDirectUrl. */
export function cdnUrlOf(txId: string): string {
  return `https://${base32(b58decode(txId))}.${CDN_SUFFIX}/${txId}/`;
}

const gatewayIdOf = (url: string): string | null =>
  url.match(/gateway\.irys\.xyz\/(?:mutable\/)?([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1] ?? null;

/** THE reliable way to get the direct CDN URL: follow the gateway's own 302
 *  and read where it landed. (The subdomain is an internal id — constructing
 *  it from the txid 404s for chunked uploads: "Illegal subpath".) Works for
 *  manifest sub-paths too (…/MANIFEST/model.glb) — the extension survives. */
export async function resolveDirectUrl(url: string): Promise<string> {
  if (!/gateway\.irys\.xyz\//.test(url)) return url; // already direct or foreign
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    void res.body?.cancel();
    return res.ok && res.url ? res.url : url;
  } catch {
    return url;
  }
}

/** Resolve a just-sealed gateway URL, retrying while it propagates. */
export async function resolveWithRetry(url: string, tries = 6, delayMs = 3000): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const out = await resolveDirectUrl(url);
    if (out !== url) return out;
    // even without redirect, a 200 on the gateway URL itself is acceptable
    try {
      const r = await fetch(url, { method: "GET", redirect: "follow" });
      void r.body?.cancel();
      if (r.ok) return r.url || url;
    } catch {
      /* keep retrying */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return url;
}

/** Legacy sync form (heuristic). Prefer resolveDirectUrl. */
export function toDirectUrl(url: string): string {
  const id = gatewayIdOf(url);
  return id ? cdnUrlOf(id) : url;
}

/** Repaired copy of a sealed metadata JSON: media fields point at the RESOLVED
 *  direct CDN URLs; the permanent gateway links ride along in *_gateway. */
export async function repairMetadataJson(meta: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...meta };
  // originals live either in the media fields (first repair) or the backups
  const imgGateway = typeof meta.image_gateway === "string" ? meta.image_gateway : typeof meta.image === "string" ? meta.image : "";
  const animGateway =
    typeof meta.animation_gateway === "string" ? meta.animation_gateway : typeof meta.animation_url === "string" ? meta.animation_url : "";
  if (imgGateway) {
    const direct = await resolveDirectUrl(imgGateway);
    out.image = direct;
    out.image_url = direct;
    out.image_gateway = imgGateway;
  }
  if (animGateway) {
    out.animation_url = await resolveDirectUrl(animGateway);
    out.animation_gateway = animGateway;
  }
  return out;
}

// ── minted-token mapping + setTokenURI ────────────────────────────────────────
/** Public RPCs rate-limit bursts ("missing revert data"). Rotate + retry. */
const RPCS = [BASE.rpc, "https://base-rpc.publicnode.com", "https://base.llamarpc.com", "https://1rpc.io/base"];
async function readWithRetry<T>(fn: (c: ethers.Contract) => Promise<T>, contract: string): Promise<T> {
  let lastErr: unknown;
  for (let round = 0; round < 2; round++) {
    for (const rpc of RPCS) {
      try {
        const c = new ethers.Contract(contract, ABI, new ethers.JsonRpcProvider(rpc));
        return await fn(c);
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  }
  throw lastErr;
}

const ABI = [
  "function totalMinted() view returns (uint256)",
  "function tokenURI(uint256) view returns (string)",
  "function setTokenURI(uint256 tokenId, string uri)",
];

/** Walk the repair lineage: a repaired metadata carries a `Repairs: <txId>`
 *  tag pointing at what it replaced. Returns true when `ancestor` appears in
 *  the chain starting at `txId` (max 6 hops). */
async function lineageIncludes(txId: string, ancestor: string): Promise<boolean> {
  let cur: string | null = txId;
  for (let hop = 0; hop < 6 && cur; hop++) {
    if (cur === ancestor) return true;
    const tags: Record<string, string> = await fetchTags(cur);
    cur = tags.Repairs && tags.Repairs !== "unknown" ? tags.Repairs : null;
  }
  return false;
}

/** ALL minted tokenIds that point at a given metadata tx — directly, via the
 *  repair lineage, or by metadata NAME (duplicate mints of the same item). */
export async function findTokensForMetadata(contract: string, metadataId: string): Promise<number[]> {
  const total = Number(await readWithRetry((c) => c.totalMinted!(), contract));
  const uris: (string | null)[] = [];
  for (let id = 1; id <= total; id++) {
    uris[id] = await readWithRetry((c) => c.tokenURI!(id) as Promise<string>, contract).catch(() => null);
  }
  const found = new Set<number>();
  for (let id = 1; id <= total; id++) {
    const uri = uris[id];
    if (!uri) continue;
    if (uri.includes(metadataId)) {
      found.add(id);
      continue;
    }
    const uriTx = txIdOf(uri);
    if (uriTx && (await lineageIncludes(uriTx, metadataId).catch(() => false))) found.add(id);
  }
  // name fallback catches duplicates whose lineage tags aren't indexed yet
  try {
    const wanted = await (await fetch(`${GATEWAY}/${metadataId}`)).json();
    const wantedName = String(wanted?.name ?? "");
    if (wantedName) {
      for (let id = 1; id <= total; id++) {
        if (found.has(id) || !uris[id]) continue;
        const m = await (await fetch(uris[id]!)).json().catch(() => null);
        if (m && String(m.name ?? "") === wantedName) found.add(id);
      }
    }
  } catch {
    /* best effort */
  }
  return [...found].sort((a, b) => a - b);
}

/** First match (kept for single-token flows). */
export async function findTokenForMetadata(contract: string, metadataId: string): Promise<number | null> {
  const total = Number(await readWithRetry((c) => c.totalMinted!(), contract));
  const uris: (string | null)[] = [];
  for (let id = 1; id <= total; id++) {
    uris[id] = await readWithRetry((c) => c.tokenURI!(id) as Promise<string>, contract).catch(() => null);
  }
  // pass 1 — direct id or repair lineage
  for (let id = total; id >= 1; id--) {
    const uri = uris[id];
    if (!uri) continue;
    if (uri.includes(metadataId)) return id;
    const uriTx = txIdOf(uri);
    if (uriTx && (await lineageIncludes(uriTx, metadataId).catch(() => false))) return id;
  }
  // pass 2 — GraphQL lag fallback: match by metadata NAME
  try {
    const wanted = await (await fetch(`${GATEWAY}/${metadataId}`)).json();
    const wantedName = String(wanted?.name ?? "");
    if (wantedName) {
      for (let id = total; id >= 1; id--) {
        const uri = uris[id];
        if (!uri) continue;
        const m = await (await fetch(uri)).json().catch(() => null);
        if (m && String(m.name ?? "") === wantedName) return id;
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function setTokenUri(provider: Eip1193Provider, contract: string, tokenId: number, uri: string): Promise<string> {
  const bp = new ethers.BrowserProvider(provider as any);
  const signer = await bp.getSigner();
  const c = new ethers.Contract(contract, ABI, signer);
  const tx = await (c as any).setTokenURI(tokenId, uri);
  await tx.wait();
  return tx.hash as string;
}

export const gatewayUrlOf = (id: string) => `${GATEWAY}/${id}`;

// ── bulk repair: every minted token on a contract ────────────────────────────
export interface RepairResult {
  tokenId: number;
  name: string;
  status: "repaired" | "skipped" | "error";
  detail?: string;
}

/** Original tags of an upload (so repairs stay in the same Vault item). */
async function fetchTags(txId: string): Promise<Record<string, string>> {
  try {
    const res = await fetch("https://uploader.irys.xyz/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `{ transactions(ids:["${txId}"]) { edges { node { tags { name value } } } } }`,
      }),
    });
    const j = await res.json();
    const tags = j?.data?.transactions?.edges?.[0]?.node?.tags ?? [];
    return Object.fromEntries(tags.map((t: { name: string; value: string }) => [t.name, t.value]));
  } catch {
    return {};
  }
}

const txIdOf = (url: string): string | null =>
  url.match(/(?:gateway\.irys\.xyz\/(?:mutable\/)?|datasprite-cdn\.com\/)([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1] ?? null;

/** Does this glb REQUIRE EXT_meshopt_compression? (marketplace viewers can't
 *  decode it — OpenSea renders a blank pane). */
export function requiresMeshopt(bytes: Uint8Array): boolean {
  try {
    if (bytes.length < 20 || String.fromCharCode(...bytes.subarray(0, 4)) !== "glTF") return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const jsonLen = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
    return Array.isArray(json.extensionsRequired) && json.extensionsRequired.includes("EXT_meshopt_compression");
  } catch {
    return false;
  }
}

/** Center-crop an image to a perfect square (marketplace card friendly).
 *  Returns null when the image is already square. */
export async function squareCrop(blob: Blob): Promise<Blob | null> {
  const bmp = await createImageBitmap(blob);
  const { width: w, height: h } = bmp;
  if (Math.abs(w - h) <= 2) return null;
  const side = Math.min(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, (w - side) / 2, (h - side) / 2, side, side, 0, 0, side, side);
  return await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
}

/** Re-seal metadata with direct media links + setTokenURI for EVERY minted
 *  token whose media still points at the redirecting gateway. */
export async function repairAllTokens(opts: {
  /** FRESH provider + Irys uploader per token — WalletConnect/Privy sessions go
   *  stale mid-run (long downloads/transcodes) and the wallet stops prompting. */
  getFresh: () => Promise<{ provider: Eip1193Provider; irys: any }>;
  uploadData: (irys: any, data: Uint8Array, ct: string, tags: { name: string; value: string }[]) => Promise<{ url: string }>;
  contract: string;
  onStep: (msg: string) => void;
  /** restrict to specific tokenIds (per-item repair) — omit for every token */
  only?: number[];
}): Promise<RepairResult[]> {
  const { getFresh, uploadData, contract, onStep, only } = opts;
  const total = Number(await readWithRetry((c) => c.totalMinted!(), contract));
  const results: RepairResult[] = [];

  for (let id = 1; id <= total; id++) {
    if (only && !only.includes(id)) continue;
    let name = `token #${id}`;
    try {
      onStep(`Refreshing wallet session (token #${id})…`);
      const { provider, irys } = await getFresh();
      onStep(`Reading token #${id}/${total}…`);
      const uri: string = await readWithRetry((c) => c.tokenURI!(id) as Promise<string>, contract);
      if (!uri) {
        results.push({ tokenId: id, name, status: "skipped", detail: "no tokenURI" });
        continue;
      }
      const res = await fetch(uri); // the browser follows the gateway 302 fine
      const meta = (await res.json()) as Record<string, unknown>;
      name = String(meta.name ?? name);

      // what SHOULD the media fields be? (resolved via the gateway's own redirect)
      const repaired = await repairMetadataJson(meta);
      // healthy = the v3 standard: media URLs carrying REAL file extensions.
      // Extensionless "direct" links are repaired too — OpenSea classifies by
      // extension and duplicate mints proved extensionless can fail ingestion.
      const hasExt =
        /\/poster\.png(\?|$)/.test(String(meta.image ?? "")) &&
        (!meta.animation_url || /\/model\.glb(\?|$)/.test(String(meta.animation_url)));

      // square the poster (marketplace cards are square — letterboxed posters look squashed)
      let squared: Blob | null = null;
      const imgGateway = typeof repaired.image_gateway === "string" ? repaired.image_gateway : "";
      if (imgGateway) {
        onStep(`Checking poster of ${name}…`);
        const blob = await (await fetch(imgGateway)).blob();
        squared = await squareCrop(blob).catch(() => null);
      }

      // transcode meshopt-compressed glbs — OpenSea's viewer can't decode them
      let plainGlb: Uint8Array | null = null;
      const animGateway = typeof repaired.animation_gateway === "string" ? repaired.animation_gateway : "";
      if (animGateway) {
        onStep(`Checking 3D model of ${name}…`);
        const glbBytes = new Uint8Array(await (await fetch(animGateway)).arrayBuffer());
        if (requiresMeshopt(glbBytes)) {
          onStep(`Transcoding ${name} for marketplace viewers…`);
          const { optimizeGLB } = await import("../three3d/optimize");
          const { validateGLB } = await import("../three3d/load");
          const out = await optimizeGLB(glbBytes, { meshCompression: false });
          const v = await validateGLB(out.bytes);
          if (v.ok && !requiresMeshopt(out.bytes)) plainGlb = out.bytes;
        }
      }

      if (hasExt && !squared && !plainGlb) {
        results.push({ tokenId: id, name, status: "skipped", detail: "already marketplace-ready" });
        continue;
      }

      // carry the ORIGINAL item tags so the repair stays inside the same Vault item
      const metaTx = txIdOf(uri);
      const orig = metaTx ? await fetchTags(metaTx) : {};
      const carry = (["Item", "Collection", "Edition", "Tier"] as const)
        .filter((k) => orig[k])
        .map((k) => ({ name: k, value: orig[k]! }));
      const markers = [
        { name: "App-Name", value: "iIrys Frame" },
        { name: "Repairs", value: metaTx ?? "unknown" },
        ...carry,
      ];

      if (squared) {
        onStep(`Sealing square poster of ${name}…`);
        const imgUp = await uploadData(irys, new Uint8Array(await squared.arrayBuffer()), "image/png", [
          ...markers,
          { name: "Type", value: "final" },
          { name: "Name", value: `${name} (square)` },
        ]);
        const direct = await resolveDirectUrl(imgUp.url);
        repaired.image = direct;
        repaired.image_url = direct;
        repaired.image_gateway = imgUp.url;
      }
      if (plainGlb) {
        onStep(`Sealing marketplace glb of ${name} (${(plainGlb.byteLength / 1048576).toFixed(1)} MB)…`);
        const glbUp = await uploadData(irys, plainGlb, "model/gltf-binary", [
          ...markers,
          { name: "Type", value: "model" },
          { name: "Name", value: `${name} (marketplace glb)` },
        ]);
        repaired.animation_url = await resolveDirectUrl(glbUp.url);
        repaired.animation_gateway = glbUp.url;
      }

      // v3 · name the media with REAL file extensions via an Irys path-manifest
      // (…/poster.png, …/model.glb — the extension survives the CDN redirect,
      // and a NEW url per revision busts the marketplace media cache)
      const posterTx = txIdOf(String(repaired.image_gateway ?? ""));
      const modelTx = txIdOf(String(repaired.animation_gateway ?? ""));
      if (posterTx || modelTx) {
        onStep(`Naming media of ${name} (extension manifest)…`);
        const paths: Record<string, { id: string }> = {};
        if (posterTx) paths["poster.png"] = { id: posterTx };
        if (modelTx) paths["model.glb"] = { id: modelTx };
        const manifest = { manifest: "arweave/paths", version: "0.1.0", ...(posterTx ? { index: { path: "poster.png" } } : {}), paths };
        const manUp = await uploadData(
          irys,
          new TextEncoder().encode(JSON.stringify(manifest)),
          "application/x.arweave-manifest+json",
          [...markers, { name: "Type", value: "media-manifest" }, { name: "Name", value: `${name} — media manifest` }],
        );
        const manId = txIdOf(manUp.url);
        if (manId) {
          if (posterTx) {
            const named = `${GATEWAY}/${manId}/poster.png`;
            const direct = await resolveWithRetry(named);
            repaired.image = direct;
            repaired.image_url = direct;
            repaired.image_gateway = named;
          }
          if (modelTx) {
            const named = `${GATEWAY}/${manId}/model.glb`;
            repaired.animation_url = await resolveWithRetry(named);
            repaired.animation_gateway = named;
          }
        }
      }

      onStep(`Re-sealing metadata of ${name} (#${id})…`);
      const up = await uploadData(irys, new TextEncoder().encode(JSON.stringify(repaired, null, 2)), "application/json", [
        ...markers,
        { name: "Type", value: "metadata" },
        { name: "Name", value: `${name} — metadata (media repair)` },
      ]);
      onStep(`setTokenURI #${id} — approve in the wallet…`);
      await setTokenUri(provider, contract, id, up.url);
      const fixes = ["named ext links", squared ? "square poster" : null, plainGlb ? "marketplace glb" : null].filter(Boolean).join(" + ");
      results.push({ tokenId: id, name, status: "repaired", detail: fixes });
    } catch (e) {
      results.push({ tokenId: id, name, status: "error", detail: String((e as Error)?.message ?? e).slice(0, 120) });
    }
  }
  return results;
}

// ── pre-mint repair: fix a SEALED-but-unminted item's metadata ────────────────
/** Same engine as the token repair (square poster + marketplace glb + named
 *  extension URLs) but with no chain writes — returns the new metadata URI so
 *  the caller mints the marketplace-ready version directly. */
export async function repairUnminted(opts: {
  irys: any;
  uploadData: (irys: any, data: Uint8Array, ct: string, tags: { name: string; value: string }[]) => Promise<{ url: string; id?: string }>;
  metadataId: string;
  onStep: (msg: string) => void;
}): Promise<{ uri: string; detail: string }> {
  const { irys, uploadData, metadataId, onStep } = opts;
  onStep("Reading sealed metadata…");
  const meta = (await (await fetch(`${GATEWAY}/${metadataId}`)).json()) as Record<string, unknown>;
  const name = String(meta.name ?? "item");
  const repaired = await repairMetadataJson(meta);

  const orig = await fetchTags(metadataId);
  const carry = (["Item", "Collection", "Edition", "Tier"] as const)
    .filter((k) => orig[k])
    .map((k) => ({ name: k, value: orig[k]! }));
  const markers = [{ name: "App-Name", value: "iIrys Frame" }, { name: "Repairs", value: metadataId }, ...carry];

  // square poster
  let squared: Blob | null = null;
  const imgGateway = typeof repaired.image_gateway === "string" ? repaired.image_gateway : "";
  if (imgGateway) {
    onStep("Checking poster…");
    const blob = await (await fetch(imgGateway)).blob();
    squared = await squareCrop(blob).catch(() => null);
    if (squared) {
      onStep("Sealing square poster…");
      const up = await uploadData(irys, new Uint8Array(await squared.arrayBuffer()), "image/png", [
        ...markers, { name: "Type", value: "final" }, { name: "Name", value: `${name} (square)` },
      ]);
      repaired.image_gateway = up.url;
    }
  }

  // marketplace glb (also shrinks unoptimized 7+ MB exports)
  let transcoded = false;
  const animGateway = typeof repaired.animation_gateway === "string" ? repaired.animation_gateway : "";
  if (animGateway) {
    onStep("Checking 3D model…");
    const bytes = new Uint8Array(await (await fetch(animGateway)).arrayBuffer());
    if (requiresMeshopt(bytes) || bytes.byteLength > 3_000_000) {
      onStep("Optimizing model for marketplaces…");
      const { optimizeGLB } = await import("../three3d/optimize");
      const { validateGLB } = await import("../three3d/load");
      const out = await optimizeGLB(bytes, { meshCompression: false });
      const v = await validateGLB(out.bytes);
      if (v.ok && !requiresMeshopt(out.bytes)) {
        onStep(`Sealing marketplace glb (${(out.bytes.byteLength / 1048576).toFixed(1)} MB)…`);
        const up = await uploadData(irys, out.bytes, "model/gltf-binary", [
          ...markers, { name: "Type", value: "model" }, { name: "Name", value: `${name} (marketplace glb)` },
        ]);
        repaired.animation_gateway = up.url;
        transcoded = true;
      }
    }
  }

  // extension-named manifest + resolved direct URLs
  const posterTx = txIdOf(String(repaired.image_gateway ?? ""));
  const modelTx = txIdOf(String(repaired.animation_gateway ?? ""));
  if (posterTx || modelTx) {
    onStep("Naming media (extension manifest)…");
    const paths: Record<string, { id: string }> = {};
    if (posterTx) paths["poster.png"] = { id: posterTx };
    if (modelTx) paths["model.glb"] = { id: modelTx };
    const manUp = await uploadData(irys, new TextEncoder().encode(JSON.stringify({ manifest: "arweave/paths", version: "0.1.0", ...(posterTx ? { index: { path: "poster.png" } } : {}), paths })),
      "application/x.arweave-manifest+json", [...markers, { name: "Type", value: "media-manifest" }, { name: "Name", value: `${name} — media manifest` }]);
    const manId = txIdOf(manUp.url);
    if (manId) {
      if (posterTx) {
        const named = `${GATEWAY}/${manId}/poster.png`;
        const direct = await resolveWithRetry(named);
        repaired.image = direct;
        repaired.image_url = direct;
        repaired.image_gateway = named;
      }
      if (modelTx) {
        const named = `${GATEWAY}/${manId}/model.glb`;
        repaired.animation_url = await resolveWithRetry(named);
        repaired.animation_gateway = named;
      }
    }
  }

  onStep("Sealing marketplace-ready metadata…");
  const up = await uploadData(irys, new TextEncoder().encode(JSON.stringify(repaired, null, 2)), "application/json", [
    ...markers, { name: "Type", value: "metadata" }, { name: "Name", value: `${name} — metadata (media repair)` },
  ]);
  const detail = ["named ext links", squared ? "square poster" : null, transcoded ? "marketplace glb" : null].filter(Boolean).join(" + ");
  return { uri: up.url, detail };
}

// ── framing fix: re-export the 3D model from the ORIGINAL file ────────────────
/** Double-converted glbs (meshopt+quantize → transcode) can carry broken
 *  bounds — marketplace viewers auto-frame by them and cut the figure off.
 *  Clean fix: run the original FBX/GLB through today's pipeline (normalize +
 *  ground + in-place + no-meshopt optimize) and re-point the minted token. */
export async function repairWithNewModel(opts: {
  provider: Eip1193Provider;
  irys: any;
  uploadData: (irys: any, data: Uint8Array, ct: string, tags: { name: string; value: string }[]) => Promise<{ url: string; id?: string }>;
  contract: string;
  metadataId: string;
  file: File;
  onStep: (msg: string) => void;
}): Promise<{ tokenId: number; uri: string }> {
  const { provider, irys, uploadData, contract, metadataId, file, onStep } = opts;

  onStep("Finding the minted token…");
  const tokenId = await findTokenForMetadata(contract, metadataId);
  if (tokenId == null) throw new Error("Token not found on the active contract");

  onStep("Reading current metadata…");
  const curUri: string = await readWithRetry((c) => c.tokenURI!(tokenId) as Promise<string>, contract);
  const meta = (await (await fetch(curUri)).json()) as Record<string, unknown>;
  const name = String(meta.name ?? "item");

  onStep(`Re-exporting ${file.name} (normalize + ground + in-place)…`);
  const { loadModelFile, exportGLB, validateGLB } = await import("../three3d/load");
  const { optimizeGLB } = await import("../three3d/optimize");
  const loaded = await loadModelFile(file);
  const raw = await exportGLB(loaded.object, loaded.animations);
  onStep("Optimizing (marketplace-safe)…");
  const out = await optimizeGLB(raw, { meshCompression: false });
  const v = await validateGLB(out.bytes);
  if (!v.ok) throw new Error(`re-export failed validation (${v.error ?? "no meshes"})`);

  const curMetaTx = txIdOf(curUri) ?? metadataId;
  const orig = await fetchTags(curMetaTx);
  const carry = (["Item", "Collection", "Edition", "Tier"] as const)
    .filter((k) => orig[k])
    .map((k) => ({ name: k, value: orig[k]! }));
  const markers = [{ name: "App-Name", value: "iIrys Frame" }, { name: "Repairs", value: curMetaTx }, ...carry];

  onStep(`Sealing re-framed glb (${(out.bytes.byteLength / 1048576).toFixed(1)} MB)…`);
  const glbUp = await uploadData(irys, out.bytes, "model/gltf-binary", [
    ...markers, { name: "Type", value: "model" }, { name: "Name", value: `${name} (reframed glb)` },
  ]);

  // keep the existing (already square) poster; re-name both with extensions
  const posterTx = txIdOf(String(meta.image_gateway ?? meta.image ?? ""));
  const modelTx = txIdOf(glbUp.url);
  onStep("Naming media (extension manifest)…");
  const paths: Record<string, { id: string }> = {};
  if (posterTx) paths["poster.png"] = { id: posterTx };
  if (modelTx) paths["model.glb"] = { id: modelTx };
  const manUp = await uploadData(irys, new TextEncoder().encode(JSON.stringify({ manifest: "arweave/paths", version: "0.1.0", ...(posterTx ? { index: { path: "poster.png" } } : {}), paths })),
    "application/x.arweave-manifest+json", [...markers, { name: "Type", value: "media-manifest" }, { name: "Name", value: `${name} — media manifest` }]);
  const manId = txIdOf(manUp.url);
  if (!manId) throw new Error("manifest id unavailable");

  const repaired: Record<string, unknown> = { ...meta };
  if (posterTx) {
    const named = `${GATEWAY}/${manId}/poster.png`;
    const direct = await resolveWithRetry(named);
    repaired.image = direct;
    repaired.image_url = direct;
    repaired.image_gateway = named;
  }
  const namedGlb = `${GATEWAY}/${manId}/model.glb`;
  repaired.animation_url = await resolveWithRetry(namedGlb);
  repaired.animation_gateway = namedGlb;

  onStep("Sealing metadata…");
  const up = await uploadData(irys, new TextEncoder().encode(JSON.stringify(repaired, null, 2)), "application/json", [
    ...markers, { name: "Type", value: "metadata" }, { name: "Name", value: `${name} — metadata (media repair)` },
  ]);
  onStep(`setTokenURI #${tokenId} — approve in the wallet…`);
  await setTokenUri(provider, contract, tokenId, up.url);
  return { tokenId, uri: up.url };
}

// ── framing fix (no original file): recenter the on-chain glb ─────────────────
/** OpenSea / model-viewer auto-frame the camera on a model's bounding-box
 *  center. A glb whose center is offset (a leftover root translation, or bounds
 *  corrupted by a meshopt→quantize→transcode round-trip) renders too high in the
 *  pane — the figure looks cut off until you drag it. This reads the ALREADY
 *  SEALED glb, recenters its bbox to the origin, transcodes any meshopt back to
 *  plain glb, re-seals, and setTokenURI — for EVERY token of the item (catches
 *  accidental duplicate mints). No re-upload of the original file required. */
export async function recenterFraming(opts: {
  getFresh: () => Promise<{ provider: Eip1193Provider; irys: any }>;
  uploadData: (irys: any, data: Uint8Array, ct: string, tags: { name: string; value: string }[]) => Promise<{ url: string; id?: string }>;
  contract: string;
  metadataId: string;
  onStep: (msg: string) => void;
}): Promise<RepairResult[]> {
  const { getFresh, uploadData, contract, metadataId, onStep } = opts;
  const { recenterGLB } = await import("../three3d/optimize");

  onStep("Finding every minted token of this item…");
  const tokenIds = await findTokensForMetadata(contract, metadataId);
  if (!tokenIds.length) throw new Error("This item isn't minted on the active contract yet");

  const results: RepairResult[] = [];
  for (const tokenId of tokenIds) {
    let name = `token #${tokenId}`;
    try {
      onStep(`Refreshing wallet session (token #${tokenId})…`);
      const { provider, irys } = await getFresh();

      onStep(`Reading token #${tokenId}…`);
      const curUri: string = await readWithRetry((c) => c.tokenURI!(tokenId) as Promise<string>, contract);
      const meta = (await (await fetch(curUri)).json()) as Record<string, unknown>;
      name = String(meta.name ?? name);

      const animGateway = String(meta.animation_gateway ?? meta.animation_url ?? "");
      if (!animGateway) {
        results.push({ tokenId, name, status: "skipped", detail: "no 3D model" });
        continue;
      }

      onStep(`Downloading 3D model of ${name}…`);
      const glbBytes = new Uint8Array(await (await fetch(animGateway)).arrayBuffer());
      onStep(`Recentering ${name}…`);
      const rc = await recenterGLB(glbBytes);
      const off = Math.hypot(...rc.offset).toFixed(2);
      const { validateGLB } = await import("../three3d/load");
      const v = await validateGLB(rc.bytes);
      if (!v.ok) throw new Error(`recentered glb failed validation (${v.error ?? "no meshes"})`);

      const curMetaTx = txIdOf(curUri) ?? metadataId;
      const orig = await fetchTags(curMetaTx);
      const carry = (["Item", "Collection", "Edition", "Tier"] as const)
        .filter((k) => orig[k])
        .map((k) => ({ name: k, value: orig[k]! }));
      const markers = [{ name: "App-Name", value: "iIrys Frame" }, { name: "Repairs", value: curMetaTx }, ...carry];

      onStep(`Sealing recentered glb of ${name} (${(rc.bytes.byteLength / 1048576).toFixed(1)} MB)…`);
      const glbUp = await uploadData(irys, rc.bytes, "model/gltf-binary", [
        ...markers, { name: "Type", value: "model" }, { name: "Name", value: `${name} (recentered glb)` },
      ]);

      // keep the existing (already square) poster; rebuild the extension manifest
      const posterTx = txIdOf(String(meta.image_gateway ?? meta.image ?? ""));
      const modelTx = txIdOf(glbUp.url);
      onStep(`Naming media of ${name} (extension manifest)…`);
      const paths: Record<string, { id: string }> = {};
      if (posterTx) paths["poster.png"] = { id: posterTx };
      if (modelTx) paths["model.glb"] = { id: modelTx };
      const manUp = await uploadData(
        irys,
        new TextEncoder().encode(JSON.stringify({ manifest: "arweave/paths", version: "0.1.0", ...(posterTx ? { index: { path: "poster.png" } } : {}), paths })),
        "application/x.arweave-manifest+json",
        [...markers, { name: "Type", value: "media-manifest" }, { name: "Name", value: `${name} — media manifest` }],
      );
      const manId = txIdOf(manUp.url);
      if (!manId) throw new Error("manifest id unavailable");

      const repaired: Record<string, unknown> = { ...meta };
      if (posterTx) {
        const named = `${GATEWAY}/${manId}/poster.png`;
        const direct = await resolveWithRetry(named);
        repaired.image = direct;
        repaired.image_url = direct;
        repaired.image_gateway = named;
      }
      const namedGlb = `${GATEWAY}/${manId}/model.glb`;
      repaired.animation_url = await resolveWithRetry(namedGlb);
      repaired.animation_gateway = namedGlb;

      onStep(`Sealing metadata of ${name}…`);
      const up = await uploadData(irys, new TextEncoder().encode(JSON.stringify(repaired, null, 2)), "application/json", [
        ...markers, { name: "Type", value: "metadata" }, { name: "Name", value: `${name} — metadata (framing repair)` },
      ]);

      onStep(`setTokenURI #${tokenId} — approve in the wallet…`);
      await setTokenUri(provider, contract, tokenId, up.url);
      results.push({
        tokenId,
        name,
        status: "repaired",
        detail: rc.moved ? `recentered (was off by ${off})` : "re-sealed centered",
      });
    } catch (e) {
      results.push({ tokenId, name, status: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
