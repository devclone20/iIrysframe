import { useMemo, useRef, useState } from "react";
import { StepShell } from "./Create";
import { Engine } from "./Engine";
import { Viewer3D } from "../three3d/Viewer3D";
import { loadModelFile, exportGLB, validateGLB, isSupported, type LoadedModel } from "../three3d/load";
import { optimizeGLB, fmtBytes } from "../three3d/optimize";
import { buildMetadata, metadataToBytes, type Attribute } from "../metadata";
import { buildAiSoul, loadSoulBundles, MONOREPO_NOTE, type MonorepoRef, type SoulConfig } from "../soul";
import {
  useWizard,
  patchWizard,
  goStep,
  addFiles,
  adoptGenerated,
  patchItem,
  removeItem,
  clearItems,
  getWizard,
  type WizItem,
} from "../wizard/wizardStore";
import { useForge, setDropManifestUri } from "../forge/forgeStore";
import { sealDropManifest } from "../forge/manifest";
import { useCollection } from "../collection";
import { useWallet } from "../wallet";
import { useStore } from "../store";
import { uploadData, blobToBytes, priceOf, ensureFunded, type UploadOut } from "../irys";
import { usdOf, fmtEth } from "../format";
import { toast, errMsg, confirmDialog, CopyField } from "../ui";
import { GATEWAY, type Tag } from "../config";

const uid = () => crypto.randomUUID();

const BG_OPTIONS = [
  { name: "Milk Rose", color: "#F7D9E3" },
  { name: "Peach", color: "#F8E2D2" },
  { name: "Vanilla", color: "#F6EFE1" },
  { name: "Mint", color: "#DCEFE4" },
  { name: "Sky", color: "#DCE8F6" },
  { name: "Lavender", color: "#E8E1F4" },
  { name: "Sand", color: "#ECE3D4" },
  { name: "Studio", color: null as string | null },
];

/* ── 4 · Assets ────────────────────────────────────────────────────────────── */
export function StepUpload() {
  const wiz = useWizard();
  const coll = useCollection();
  const is3d = wiz.kind === "3d";
  const isLayers = wiz.scope === "layers";
  const single = wiz.scope === "single";
  const accept = is3d ? ".fbx,.glb,.gltf,.obj" : "image/*";
  const [over, setOver] = useState(false);

  function onFiles(files: File[]) {
    const good = is3d ? files.filter((f) => isSupported(f.name)) : files.filter((f) => f.type.startsWith("image/"));
    if (good.length === 0) return toast(is3d ? "Use FBX, GLB, GLTF or OBJ" : "Use image files", "err");
    const take = single ? good.slice(0, 1) : good;
    if (single && wiz.items.length > 0) clearItems();
    addFiles(take);
    // 2D images are already "art" — poster = the file itself
    if (!is3d) {
      for (const it of getWizard().items.filter((i) => !i.poster && i.file)) {
        patchItem(it.id, { poster: it.file!, posterUrl: URL.createObjectURL(it.file!), status: "ready" });
      }
    }
  }

  const staged = coll.staged;

  return (
    <StepShell
      title={isLayers ? "Layer engine" : single ? "Your item" : "Your collection"}
      lead={
        isLayers
          ? "Build trait folders with rarity weights and generate the collection — then adopt the result into the flow."
          : is3d
            ? "Drop your 3D models (FBX rigged, GLB, GLTF, OBJ). As many as you can pay to seal — there is no platform limit."
            : "Drop your finished images. As many as you can pay to seal — there is no platform limit."
      }
      canNext={wiz.items.length > 0}
    >
      {isLayers ? (
        <>
          <div className="wizard__embed">
            <Engine goIrys={() => toast("Generated — now adopt the collection below", "ok")} />
          </div>
          <button
            className="btn btn--primary btn--block"
            disabled={!staged || staged.items.length === 0}
            onClick={() => {
              if (!staged) return;
              adoptGenerated(
                staged.items.map((s) => ({
                  id: uid(),
                  sourceName: s.name,
                  name: s.name,
                  size: s.blob.size,
                  status: "ready" as const,
                  poster: s.blob,
                  posterUrl: URL.createObjectURL(s.blob),
                  attributes: s.attributes,
                })),
              );
              toast(`Adopted ${staged.items.length} generated items`, "ok");
            }}
          >
            {staged && staged.items.length > 0 ? `Adopt generated collection (${staged.items.length} items)` : "Generate above first"}
          </button>
        </>
      ) : (
        <label
          className={`e3d__drop wizard__drop ${over ? "is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            onFiles([...(e.dataTransfer.files ?? [])]);
          }}
        >
          <input type="file" accept={accept} multiple={!single} hidden onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
          <p>{single ? "Drop your file" : "Drop your files"}</p>
          <span>{is3d ? "FBX (rigged) · GLB · GLTF · OBJ" : "PNG · JPG · WEBP · GIF"}</span>
        </label>
      )}

      {wiz.items.length > 0 && !isLayers && (
        <div className="batch" style={{ marginTop: 14 }}>
          {wiz.items.map((b, i) => (
            <div className={`batch__row is-${b.status}`} key={b.id}>
              <span className="batch__idx">{i + 1}</span>
              {b.posterUrl ? <img className="batch__thumb" src={b.posterUrl} alt="" /> : <span className="batch__thumb" />}
              <div className="batch__meta">
                <span className="batch__name">{b.name}</span>
                <span className="batch__sub">{fmtBytes(b.size)}</span>
              </div>
              <button className="variant__x" onClick={() => removeItem(b.id)} title="Remove">✕</button>
            </div>
          ))}
        </div>
      )}
    </StepShell>
  );
}

/* ── 7 · Process ───────────────────────────────────────────────────────────── */
export function StepProcess() {
  const wiz = useWizard();
  const forge = useForge();
  const is3d = wiz.kind === "3d";
  const [busy, setBusy] = useState(false);
  const [stepTxt, setStepTxt] = useState("");
  const [current, setCurrent] = useState<{ model: LoadedModel; key: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bg = wiz.background;

  const pending = wiz.items.filter((i) => i.status === "queued" || i.status === "error").length;

  function assignTiers() {
    const items = getWizard().items;
    const tiers = forge.drop.tiers.filter((t) => t.pct > 0);
    const total = tiers.reduce((s, t) => s + t.pct, 0) || 1;
    const counts = tiers.map((t) => Math.floor((t.pct / total) * items.length));
    let assigned = counts.reduce((s, c) => s + c, 0);
    while (assigned < items.length) {
      counts[0] = (counts[0] ?? 0) + 1;
      assigned++;
    }
    const seq: string[] = [];
    tiers.forEach((t, i) => {
      for (let k = 0; k < (counts[i] ?? 0); k++) seq.push(t.name);
    });
    items.forEach((it, i) => patchItem(it.id, { tier: seq[i] ?? tiers[0]?.name }));
    toast("Rarity tiers distributed", "ok");
  }

  async function capturePoster(): Promise<Blob | null> {
    const el = canvasRef.current;
    if (!el) return null;
    // center-crop to a perfect square — marketplace cards are square, and a
    // letterboxed poster reads as "squashed" on OpenSea
    const side = Math.min(el.width, el.height);
    const square = document.createElement("canvas");
    square.width = square.height = side;
    const ctx = square.getContext("2d")!;
    ctx.drawImage(el, (el.width - side) / 2, (el.height - side) / 2, side, side, 0, 0, side, side);
    return await new Promise<Blob | null>((res) => square.toBlob(res, "image/png"));
  }

  async function processAll() {
    if (busy) return;
    setBusy(true);
    try {
      if (!is3d) {
        // 2D: images are final — just confirm readiness
        for (const it of getWizard().items) {
          if (it.status !== "ready" && it.file) {
            patchItem(it.id, { poster: it.file, posterUrl: URL.createObjectURL(it.file), status: "ready" });
          }
        }
      } else {
        for (const it of getWizard().items) {
          if (it.status === "ready" || it.status === "sealed" || !it.file) continue;
          patchItem(it.id, { status: "processing", error: undefined });
          try {
            setStepTxt(`Loading ${it.name}…`);
            const loaded = await loadModelFile(it.file);
            setCurrent({ model: loaded, key: uid() });
            await new Promise((r) => setTimeout(r, 1600)); // FitCamera + async textures
            setStepTxt(`Poster ${it.name}…`);
            const poster = await capturePoster();
            setStepTxt(`Optimizing ${it.name}…`);
            const raw = await exportGLB(loaded.object, loaded.animations);
            let glb = raw;
            let before = raw.byteLength;
            let after = raw.byteLength;
            try {
              // meshCompression OFF: OpenSea's viewer has no meshopt decoder (white pane)
              const res = await optimizeGLB(raw, { maxTexture: 2048, quality: 0.85, meshCompression: false });
              const v = await validateGLB(res.bytes);
              if (v.ok) {
                glb = res.bytes;
                before = res.before;
                after = res.after;
              }
              // Recenter the bbox to origin so OpenSea / model-viewer auto-frame
              // the figure dead-center in the pane (no off-center on the detail
              // view). No-op for already-centered models.
              try {
                const { recenterGLB } = await import("../three3d/optimize");
                const rc = await recenterGLB(glb);
                const rv = await validateGLB(rc.bytes);
                if (rv.ok) {
                  glb = rc.bytes;
                  after = rc.bytes.byteLength;
                }
              } catch {
                /* keep the optimized (uncentered) glb */
              }
            } catch {
              /* keep raw */
            }
            patchItem(it.id, {
              status: "ready",
              glb,
              before,
              after,
              poster: poster ?? undefined,
              posterUrl: poster ? URL.createObjectURL(poster) : undefined,
              tris: loaded.stats.triangles,
              clips: loaded.animations.length,
            });
          } catch (e) {
            patchItem(it.id, { status: "error", error: errMsg(e) });
          }
        }
      }
      // tiers ride along automatically
      if (getWizard().items.some((i) => !i.tier)) assignTiers();
      const ready = getWizard().items.filter((i) => i.status === "ready").length;
      toast(`Processed — ${ready}/${getWizard().items.length} ready`, "ok");
    } finally {
      setBusy(false);
      setStepTxt("");
    }
  }

  return (
    <StepShell
      title={is3d ? "Optimize & posters" : "Prepare the collection"}
      lead={
        is3d
          ? "Each model is compressed (meshopt + WebP, ~90% smaller, animation intact) and gets a poster captured from the viewer — the image OpenSea shows."
          : "Your images are the art itself — this step distributes rarity tiers and locks the set."
      }
      canNext={wiz.items.length > 0 && wiz.items.every((i) => i.status === "ready" || i.status === "sealed")}
    >
      {is3d && (
        <div className="wizard__stage" style={current && bg.color ? { background: bg.color } : undefined}>
          {current ? (
            <Viewer3D
              key={current.key}
              object={current.model.object}
              animations={current.model.animations}
              animIndex={0}
              autoRotate={current.model.animations.length === 0}
              background={bg.color}
              onCanvas={(el) => (canvasRef.current = el)}
            />
          ) : (
            <div className="wizard__stage-empty">The processor shows each model here while it works</div>
          )}
        </div>
      )}
      {is3d && (
        <div className="e3d__bgbar" style={{ marginTop: 10 }}>
          <span className="e3d__bglabel">Poster background</span>
          <div className="e3d__swatches">
            {BG_OPTIONS.map((o) => (
              <button
                key={o.name}
                className={`e3d__swatch ${bg.name === o.name ? "is-on" : ""} ${o.color ? "" : "e3d__swatch--studio"}`}
                style={o.color ? { background: o.color } : undefined}
                title={o.name}
                onClick={() => patchWizard({ background: o })}
              />
            ))}
          </div>
          <span className="e3d__bgname">{bg.name}</span>
        </div>
      )}

      <div className="wizard__grid">
        {wiz.items.map((b) => (
          <div className={`wizitem is-${b.status}`} key={b.id}>
            <div className="wizitem__media">{b.posterUrl ? <img src={b.posterUrl} alt="" /> : <span className="wizitem__ph">{b.status}</span>}</div>
            <div className="wizitem__foot">
              <span className="wizitem__name">{b.name}</span>
              <select className="wizitem__tier" value={b.tier ?? ""} onChange={(e) => patchItem(b.id, { tier: e.target.value || undefined })}>
                <option value="">tier</option>
                {forge.drop.tiers.map((t) => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
            <span className="wizitem__sub">
              {b.after != null && b.before ? `${fmtBytes(b.after)} · −${Math.max(0, Math.round((1 - b.after / b.before) * 100))}%` : fmtBytes(b.size)}
              {b.clips != null && ` · ${b.clips} clip${b.clips === 1 ? "" : "s"}`}
              {b.error && ` · ${b.error}`}
            </span>
          </div>
        ))}
      </div>

      <div className="irys-actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn btn--primary" disabled={busy} onClick={processAll}>
          {busy ? stepTxt || "Processing…" : pending > 0 ? `Process ${pending} item${pending === 1 ? "" : "s"}` : "Re-process"}
        </button>
        <button className="btn btn--ghost" onClick={assignTiers} disabled={wiz.items.length === 0}>
          Redistribute rarity
        </button>
      </div>
    </StepShell>
  );
}

/* ── 8 · Seal ──────────────────────────────────────────────────────────────── */
export function StepSeal({ goLaunch }: { goLaunch: () => void }) {
  const wiz = useWizard();
  const w = useWallet();
  const store = useStore();
  const is3d = wiz.kind === "3d";
  const [busy, setBusy] = useState(false);
  const [stepTxt, setStepTxt] = useState("");
  const [quote, setQuote] = useState<{ eth: string; free: number; paid: number } | null>(null);

  const ready = wiz.items.filter((i) => i.status === "ready");
  const totalBytes = useMemo(
    () => ready.reduce((s, b) => s + (b.glb?.byteLength ?? 0) + (b.poster?.size ?? 0) + 2600, 0),
    [ready],
  );
  const soulsById = useMemo(() => new Map(wiz.souls.map((s) => [s.id, s])), [wiz.souls]);
  // Distinct preset souls attached to items being sealed — each one's full-body
  // bundle (soul + embedded monorepo) is sealed ONCE and referenced from every
  // token that carries that soul (ai_soul.monorepo).
  const soulsUsed = useMemo<SoulConfig[]>(() => {
    if (!wiz.soulsOn) return [];
    const ids = [...new Set(ready.map((b) => b.soulId).filter((id): id is string => !!id))];
    return ids.map((id) => soulsById.get(id)).filter((s): s is (typeof wiz.souls)[number] => !!s);
  }, [wiz.soulsOn, ready, soulsById]);

  async function quoteNow() {
    if (!store.irys) return toast("Connect your wallet first", "err");
    setStepTxt("Quoting…");
    try {
      let need = 0n;
      let free = 0;
      let paid = 0;
      for (const b of ready) {
        for (const s of [b.glb?.byteLength ?? 0, b.poster?.size ?? 0, 2600]) {
          if (s === 0) continue;
          const q = await priceOf(store.irys, s);
          need += BigInt(q.atomic);
          if (q.free) free++;
          else paid++;
        }
      }
      for (const { bytes } of (await loadSoulBundles(soulsUsed)).values()) {
        const q = await priceOf(store.irys, bytes.byteLength);
        need += BigInt(q.atomic);
        if (q.free) free++;
        else paid++;
      }
      setQuote({ eth: (Number(need) / 1e18).toFixed(6), free, paid });
    } catch (e) {
      toast(`Quote failed: ${errMsg(e)}`, "err");
    } finally {
      setStepTxt("");
    }
  }

  async function sealAll() {
    if (ready.length === 0) return toast("Nothing ready to seal", "err");
    if (!w.connected) return toast("Connect your wallet first", "err");
    if (!w.onBase) return toast("Switch to Base first", "err");
    if (!store.irys) return toast("Wallet not ready — try again in a moment", "err");

    const ok = await confirmDialog(
      "Seal on Irys — permanent",
      `Store <strong>${ready.length} item${ready.length === 1 ? "" : "s"}</strong> (${fmtBytes(totalBytes)}) forever on Irys, plus the drop manifest${soulsUsed.some((s) => s.bundlePath) ? " and each soul's full-body bundle (soul + entire monorepo)" : ""}. Files under 100 KiB are free; the rest is paid from your Irys credit in Base ETH. Irreversible.`,
      "Seal now",
    );
    if (!ok) return;

    setBusy(true);
    try {
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet provider unavailable");
      setStepTxt("Funding storage…");
      const bundles = await loadSoulBundles(soulsUsed);
      let need = 0n;
      for (const b of ready) {
        for (const s of [b.glb?.byteLength ?? 0, b.poster?.size ?? 0, 2600]) {
          if (s > 0) need += BigInt((await priceOf(store.irys, s)).atomic);
        }
      }
      for (const { bytes } of bundles.values()) {
        need += BigInt((await priceOf(store.irys, bytes.byteLength)).atomic);
      }
      await ensureFunded(store.irys, need, provider);

      const collection = wiz.naming.collection.trim();

      // Seal each distinct full-body soul bundle once; every token carrying
      // that soul references the same permanent document (ai_soul.monorepo).
      const monorepoByPath = new Map<string, MonorepoRef>();
      for (const [path, b] of bundles) {
        const soulName = soulsUsed.find((s) => s.bundlePath === path)?.name || "soul";
        setStepTxt(`Sealing ${soulName} — full-body soul bundle…`);
        const bTags: Tag[] = [
          { name: "App-Name", value: "iIrys Frame" },
          { name: "Type", value: "soul-bundle" },
          { name: "Name", value: `${soulName} — full-body soul bundle` },
          ...(collection ? [{ name: "Collection", value: collection }] : []),
        ];
        const up = await uploadData(store.irys, b.bytes, "text/markdown", bTags);
        monorepoByPath.set(path, { url: up.url, sha256: b.sha256, bytes: b.bytes.byteLength, note: MONOREPO_NOTE });
      }

      const metadataIds: string[] = [];
      let edition = 0;

      for (const b of ready) {
        edition += 1;
        patchItem(b.id, { status: "sealing" });
        const item = uid();
        const tags = (type: string, tagName: string, extra: Tag[] = []): Tag[] => [
          { name: "App-Name", value: "iIrys Frame" },
          { name: "Item", value: item },
          { name: "Name", value: tagName },
          { name: "Type", value: type },
          { name: "Edition", value: String(edition) },
          ...(collection ? [{ name: "Collection", value: collection }] : []),
          ...(b.tier ? [{ name: "Tier", value: b.tier }] : []),
          ...extra,
        ];
        try {
          let modelUp: UploadOut | null = null;
          if (is3d && b.glb) {
            setStepTxt(`Sealing ${b.name} (${edition}/${ready.length}) — glb…`);
            modelUp = await uploadData(store.irys, b.glb, "model/gltf-binary", tags("model", b.name, [
              { name: "Animated", value: (b.clips ?? 0) > 0 ? "true" : "false" },
            ]));
          }
          let imageUp: UploadOut | null = null;
          if (b.poster) {
            setStepTxt(`Sealing ${b.name} — image…`);
            imageUp = await uploadData(store.irys, await blobToBytes(b.poster), b.poster.type || "image/png", tags("final", b.name));
          }
          setStepTxt(`Sealing ${b.name} — metadata…`);
          const attributes: Attribute[] = [
            ...(b.attributes ?? []),
            ...(is3d
              ? [
                  { trait_type: "Type", value: "3D Agent" },
                  { trait_type: "Animated", value: (b.clips ?? 0) > 0 ? "Yes" : "No" },
                  { trait_type: "Format", value: "glb" },
                ]
              : []),
            ...(b.tier ? [{ trait_type: "Tier", value: b.tier }] : []),
          ];
          if (is3d && wiz.background.color) attributes.push({ trait_type: "Background", value: wiz.background.name });
          const soul = wiz.soulsOn && b.soulId ? soulsById.get(b.soulId) : undefined;
          if (soul) {
            attributes.push({ trait_type: "Soul", value: soul.name || soul.preset });
            if (soul.personality) attributes.push({ trait_type: "Personality", value: soul.personality });
            attributes.push({ trait_type: "Base Model", value: soul.baseModel });
          }
          // marketplace-grade media URLs: a tiny Irys path-manifest names the
          // sealed files with REAL extensions (…/poster.png, …/model.glb) —
          // OpenSea classifies media by URL extension; we then resolve to the
          // direct CDN form (200 + cacheable). Gateway links ride in *_gateway.
          const { resolveWithRetry } = await import("../forge/repair");
          let imgFinal = "";
          let animFinal: string | undefined;
          let imgGw: string | undefined;
          let animGw: string | undefined;
          {
            const paths: Record<string, { id: string }> = {};
            if (imageUp) paths["poster.png"] = { id: imageUp.id };
            if (modelUp) paths["model.glb"] = { id: modelUp.id };
            const manifest = { manifest: "arweave/paths", version: "0.1.0", ...(imageUp ? { index: { path: "poster.png" } } : {}), paths };
            setStepTxt(`Sealing ${b.name} — media manifest…`);
            const manUp = await uploadData(store.irys, new TextEncoder().encode(JSON.stringify(manifest)),
              "application/x.arweave-manifest+json", tags("media-manifest", `${b.name} — media manifest`));
            if (imageUp) {
              imgGw = `${GATEWAY}/${manUp.id}/poster.png`;
              imgFinal = await resolveWithRetry(imgGw);
            }
            if (modelUp) {
              animGw = `${GATEWAY}/${manUp.id}/model.glb`;
              animFinal = await resolveWithRetry(animGw);
            }
          }
          const meta = buildMetadata({
            name: b.name,
            description: wiz.description,
            image: imgFinal || animFinal || "",
            animation_url: animFinal,
            background_color: is3d ? (wiz.background.color ?? undefined) : undefined,
            attributes,
            ai_soul: soul
              ? (buildAiSoul(
                  soul,
                  item.slice(0, 8),
                  undefined,
                  soul.bundlePath ? monorepoByPath.get(soul.bundlePath) : undefined,
                ) as unknown as Record<string, unknown>)
              : undefined,
          }) as unknown as Record<string, unknown>;
          if (imgGw) meta.image_gateway = imgGw;
          if (animGw) meta.animation_gateway = animGw;
          const metaUp = await uploadData(store.irys, new TextEncoder().encode(JSON.stringify(meta, null, 2)), "application/json", tags("metadata", `${b.name} — metadata`));
          metadataIds.push(metaUp.id);
          patchItem(b.id, {
            status: "sealed",
            sealed: { model: modelUp?.url ?? null, image: imageUp?.url ?? null, metadata: metaUp.url, metadataId: metaUp.id },
          });
        } catch (e) {
          patchItem(b.id, { status: "error", error: errMsg(e) });
        }
      }

      if (metadataIds.length > 0) {
        setStepTxt("Sealing drop manifest…");
        const man = await sealDropManifest(store.irys, metadataIds, collection || "collection");
        setDropManifestUri(man.baseURI);
        patchWizard({ sealBaseURI: man.baseURI, sealedAt: Date.now() });
        toast(`Sealed ${metadataIds.length} items — collection is permanent`, "ok");
      }
      await store.refresh();
      await store.loadInventory();
    } catch (e) {
      toast(`Seal failed: ${errMsg(e)}`, "err");
    } finally {
      setBusy(false);
      setStepTxt("");
    }
  }

  const sealedCount = wiz.items.filter((i) => i.status === "sealed").length;

  return (
    <StepShell
      title="Seal on Irys"
      lead="This writes your art, metadata and souls permanently to the Irys datachain — the mint links outlive any server. You pay storage once, in Base ETH; files under 100 KiB are free."
      canNext={wiz.sealedAt != null}
      nextLabel="Open Launch"
      onNext={goLaunch}
    >
      <div className="irys-summary">
        <div className="irys-row"><span>Items ready</span><strong>{ready.length}{sealedCount > 0 ? ` · ${sealedCount} sealed` : ""}</strong></div>
        <div className="irys-row"><span>Bundle</span><strong>{fmtBytes(totalBytes)}</strong></div>
        {quote && (
          <div className="irys-row is-accent">
            <span>Storage cost</span>
            <strong>
              {Number(quote.eth) === 0 ? "FREE" : `${fmtEth(quote.eth)} ETH${usdOf(quote.eth, store.ethUsd) ? ` ≈ ${usdOf(quote.eth, store.ethUsd)}` : ""}`}
            </strong>
          </div>
        )}
      </div>
      <div className="irys-actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn btn--ghost" onClick={quoteNow} disabled={!w.connected || ready.length === 0}>
          Quote cost
        </button>
      </div>
      {stepTxt && <p className="e3d__seal-meta">{stepTxt}</p>}
      <button className="btn btn--primary btn--block" disabled={busy || ready.length === 0 || !w.connected} onClick={sealAll}>
        {busy ? stepTxt || "Sealing…" : !w.connected ? "Connect wallet to seal" : `Seal ${ready.length} item${ready.length === 1 ? "" : "s"} on Irys`}
      </button>

      {wiz.sealBaseURI && (
        <div className="e3d__result">
          <div className="e3d__result-head">Collection sealed — drop manifest ready</div>
          <label>tokenURI base (manifest)</label>
          <CopyField value={wiz.sealBaseURI} />
          <span className="e3d__soulhint">Every item's mint link lives in Launch — mint the whole collection there, or hand the data to OpenSea's console.</span>
        </div>
      )}
    </StepShell>
  );
}
