import { useMemo, useRef, useState } from "react";
import type { RootState } from "@react-three/fiber";
import { StepShell } from "./Create";
import { Engine } from "./Engine";
import { Viewer3D } from "../three3d/Viewer3D";
import { loadModelFile, exportGLB, validateGLB, isSupported, detectBakedBackdrop, type LoadedModel } from "../three3d/load";
import { optimizeGLB, fmtBytes } from "../three3d/optimize";
import { buildMetadata, metadataToBytes, type Attribute } from "../metadata";
import { buildAiSoul, bundlePathFor, loadSoulBundles, MONOREPO_NOTE, type MonorepoRef, type SoulConfig } from "../soul";
import {
  useWizard,
  patchWizard,
  goStep,
  addFiles,
  adoptGenerated,
  patchItem,
  assignSouls,
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
];

/* ── per-item backgrounds ─────────────────────────────────────────────────────
 * One colour for the whole drop was the launch mistake this exists to prevent:
 * every card on the collection page read identical. "auto" hands each NFT its
 * own soft milky pastel, deterministically (same seed → same colours), spread
 * around the hue wheel by the golden angle so neighbours never match. */

const HUE_NAMES: [number, string][] = [
  [14, "Rose"], [40, "Peach"], [62, "Butter"], [95, "Lime"], [130, "Sage"],
  [165, "Mint"], [190, "Aqua"], [215, "Sky"], [245, "Periwinkle"],
  [278, "Lavender"], [308, "Lilac"], [338, "Orchid"], [361, "Rose"],
];

function hueName(h: number): string {
  const hue = ((h % 360) + 360) % 360;
  for (const [t, n] of HUE_NAMES) if (hue <= t) return n;
  return "Rose";
}

function hslHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/** Deterministic milky pastel for item i — near-milk lightness, gentle chroma. */
function pastelFor(seed: number, i: number): { hex: string; name: string } {
  let s = (seed + i * 0x9e3779b9) >>> 0;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hue = (seed * 137.508 + i * 137.508 + rand() * 24) % 360;
  const sat = 34 + rand() * 18;              // soft, never neon
  const light = 81 + rand() * 7;             // "quase leite"
  return { hex: hslHex(hue, sat, light), name: `Milk ${hueName(hue)}` };
}

function hexHueName(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.04) return mx < 0.35 ? "Graphite" : mx < 0.7 ? "Slate" : "Bone";
  let h = 0;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return hueName(h * 60);
}

/** The item's real background: baked (from the file) beats every setting;
 * otherwise the wizard's mode decides. Returned hex includes the leading #. */
function resolveItemBg(
  it: WizItem,
  mode: "auto" | "fixed" | "none",
  fixed: { name: string; color: string | null },
  seed: number,
  index: number,
): { hex: string | null; name: string } {
  if (it.hasOwnBg && it.bakedRim) {
    return { hex: `#${it.bakedRim.toUpperCase()}`, name: hexHueName(it.bakedHex ?? it.bakedRim) };
  }
  if (mode === "auto") return pastelFor(seed >>> 0 || 1, index);
  if (mode === "fixed" && fixed.color) return { hex: fixed.color, name: fixed.name };
  return { hex: null, name: "Studio" };
}

/** Filename without directory or extension — the key that pairs a model with a
 * poster dropped beside it. */
function stemOf(name: string): string {
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

/** The name the poster takes inside the Irys path-manifest. OpenSea classifies
 * media by URL extension, so the path has to tell the truth about the bytes —
 * a supplied still is usually a JPEG, a captured one is always a PNG. */
export function posterPathFor(poster?: Blob | null): string {
  const t = poster?.type ?? "";
  if (t === "image/jpeg" || t === "image/jpg") return "poster.jpg";
  if (t === "image/webp") return "poster.webp";
  return "poster.png";
}

/** Posters dropped before (or after) their models wait here until they match.
 * Module scope, because a drop can arrive in any order and across renders. */
const pendingPosters = new Map<string, File>();

/** Attach every pending image to the model that shares its filename. The
 * viewer's own capture is only ever as big as the window; a supplied still keeps
 * its full resolution, which is what OpenSea's 3000px recommendation needs. */
async function attachPendingPosters() {
  for (const it of getWizard().items) {
    if (it.posterProvided) continue;
    const f = pendingPosters.get(stemOf(it.sourceName));
    if (!f) continue;
    pendingPosters.delete(stemOf(it.sourceName));
    let dims: { w: number; h: number } | undefined;
    try {
      const bmp = await createImageBitmap(f);
      dims = { w: bmp.width, h: bmp.height };
      bmp.close();
    } catch {
      /* dimensions are a nicety, not a requirement */
    }
    patchItem(it.id, {
      poster: f,
      posterUrl: URL.createObjectURL(f),
      posterProvided: true,
      posterDims: dims,
    });
  }
}

/** Read the baked backdrop of every queued GLB.
 *
 * The backdrop lives in the JSON chunk at the head of the file, so only the head
 * is read — dropping 1111 models used to fire 1111 full-file reads at once
 * (~20 GB in flight) and could take the tab down before anything was processed.
 * A small queue keeps it to a few slices at a time. */
async function detectBackdrops(headBytes = 512 * 1024, lanes = 6) {
  const todo = getWizard().items.filter(
    (i) => i.status === "queued" && i.hasOwnBg == null && i.file && /\.glb$/i.test(i.sourceName),
  );
  let next = 0;
  const worker = async () => {
    for (;;) {
      const it = todo[next++];
      if (!it || !it.file) return;
      try {
        const head = await it.file.slice(0, headBytes).arrayBuffer();
        const baked = detectBakedBackdrop(head);
        patchItem(it.id, baked ? { hasOwnBg: true, bakedHex: baked.hex, bakedRim: baked.rim } : { hasOwnBg: false });
      } catch {
        patchItem(it.id, { hasOwnBg: false });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, todo.length) }, worker));
}

/* ── 4 · Assets ────────────────────────────────────────────────────────────── */
export function StepUpload() {
  const wiz = useWizard();
  const coll = useCollection();
  const is3d = wiz.kind === "3d";
  const isLayers = wiz.scope === "layers";
  const single = wiz.scope === "single";
  const accept = is3d ? ".fbx,.glb,.gltf,.obj,image/*" : "image/*";
  const [over, setOver] = useState(false);

  function onFiles(files: File[]) {
    // In 3D, an image is not an item — it is the poster for the model of the same
    // name. Drop models and stills together and they pair themselves up.
    if (is3d) {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (imgs.length) {
        for (const f of imgs) pendingPosters.set(stemOf(f.name), f);
        void attachPendingPosters();
      }
      files = files.filter((f) => !f.type.startsWith("image/"));
      if (!files.length) {
        return toast(
          imgs.length
            ? `${imgs.length} poster${imgs.length === 1 ? "" : "s"} paired by filename`
            : "Use FBX, GLB, GLTF or OBJ",
          imgs.length ? "ok" : "err",
        );
      }
    }
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
    // GLBs may carry their own baked backdrop (iCLONE dome) — detect on drop so
    // the app never paints a second background over one the art already has.
    if (is3d) {
      void detectBackdrops();
      void attachPendingPosters();          // models may have arrived after their stills
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
                <span className="batch__sub">
                  {fmtBytes(b.size)}
                  {b.hasOwnBg ? " · own background ✓" : ""}
                  {b.posterProvided
                    ? ` · poster ${b.posterDims ? `${b.posterDims.w}×${b.posterDims.h}` : "supplied"} ✓`
                    : ""}
                </span>
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
  const [current, setCurrent] = useState<{ model: LoadedModel; key: string; color: string | null } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const r3fRef = useRef<RootState | null>(null);
  const bg = wiz.background;
  const mode = wiz.bgMode;

  /** A background change invalidates every captured poster (the colour is baked
   * into the pixels) — re-queue what was ready so nothing seals stale. */
  function requeuePosters() {
    for (const it of getWizard().items) {
      // a supplied poster carries its own background: no setting can stale it
      if (it.status === "ready" && !it.hasOwnBg && !it.posterProvided) {
        patchItem(it.id, { status: "queued" });
      }
    }
  }

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
    // Draw a fresh frame RIGHT NOW. The render loop only runs while the window
    // is visible — capturing without this yields a black poster whenever the
    // app is occluded or backgrounded during a long batch.
    const st = r3fRef.current;
    if (st) {
      try {
        st.gl.render(st.scene, st.camera);
      } catch {
        /* fall back to whatever the loop last painted */
      }
    }
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
        const seed = (wiz.naming.seed >>> 0) || 1;
        for (const it of getWizard().items) {
          if (it.status === "ready" || it.status === "sealed" || !it.file) continue;
          const index = getWizard().items.findIndex((x) => x.id === it.id);
          patchItem(it.id, { status: "processing", error: undefined });
          try {
            // this item's OWN colour — baked rim from the file, or its assigned
            // pastel; painted into the viewer so the poster captures it
            const resolved = resolveItemBg(it, mode, wiz.background, seed, index);
            patchItem(it.id, { bgHex: resolved.hex, bgName: resolved.name });
            setStepTxt(`Loading ${it.name}…`);
            const loaded = await loadModelFile(it.file);
            // A supplied poster needs no viewer at all: skip the canvas boot and
            // the settle wait, which is most of the per-item time on a big drop.
            let poster: Blob | null = it.posterProvided ? (it.poster ?? null) : null;
            if (!poster) {
              canvasRef.current = null;       // stale canvas = previous item's frame
              r3fRef.current = null;
              setCurrent({ model: loaded, key: uid(), color: resolved.hex });
              // The GL canvas only boots once the window actually lays out — wait
              // for it (not a fixed delay), or an occluded window skips posters.
              const tCanvas = Date.now();
              while (!canvasRef.current && Date.now() - tCanvas < 10_000) {
                await new Promise((r) => setTimeout(r, 100));
              }
              await new Promise((r) => setTimeout(r, 1600)); // FitCamera + async textures
              setStepTxt(`Poster ${it.name}…`);
              poster = await capturePoster();
            }
            let glb: Uint8Array;
            let before: number;
            let after: number;
            if (it.hasOwnBg && /\.glb$/i.test(it.sourceName)) {
              // The file already carries its finished backdrop (and, for iCLONE,
              // hand-fixed skinning). Seal the ORIGINAL bytes untouched — any
              // re-export or texture downscale would only degrade finished art.
              setStepTxt(`Validating ${it.name}…`);
              glb = new Uint8Array(await it.file.arrayBuffer());
              before = after = glb.byteLength;
              const v = await validateGLB(glb);
              if (!v.ok) throw new Error(v.error || "GLB failed validation");
            } else {
              setStepTxt(`Optimizing ${it.name}…`);
              const raw = await exportGLB(loaded.object, loaded.animations);
              glb = raw;
              before = raw.byteLength;
              after = raw.byteLength;
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
            }
            // No poster = an NFT whose marketplace card is blank. The capture
            // returns null whenever the window was occluded or the step left
            // mid-batch; marking that "ready" seals the emptiness permanently.
            if (!poster) {
              patchItem(it.id, {
                status: "error",
                glb,
                before,
                after,
                tris: loaded.stats.triangles,
                clips: loaded.animations.length,
                error: "No poster captured — keep this window in front while processing, or drop a still named like the model.",
              });
              continue;
            }
            patchItem(it.id, {
              status: "ready",
              glb,
              before,
              after,
              poster,
              posterUrl: URL.createObjectURL(poster),
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
          ? "Each model is compressed (meshopt + WebP, ~90% smaller, animation intact) and gets a poster — the image OpenSea shows. A still dropped beside the model (same filename) is used as-is, at its own resolution; otherwise it is captured from the viewer."
          : "Your images are the art itself — this step distributes rarity tiers and locks the set."
      }
      canNext={wiz.items.length > 0 && wiz.items.every((i) => i.status === "ready" || i.status === "sealed")}
    >
      {is3d && (
        <div className="wizard__stage" style={current?.color ? { background: current.color } : undefined}>
          {current ? (
            <Viewer3D
              key={current.key}
              object={current.model.object}
              animations={current.model.animations}
              animIndex={0}
              autoRotate={current.model.animations.length === 0}
              background={current.color}
              margin={1.18}
              onCanvas={(el) => (canvasRef.current = el)}
              onReady={(s) => (r3fRef.current = s)}
            />
          ) : (
            <div className="wizard__stage-empty">The processor shows each model here while it works</div>
          )}
        </div>
      )}
      {is3d && (
        <div className="e3d__bgbar" style={{ marginTop: 10 }}>
          <span className="e3d__bglabel">Backgrounds</span>
          <div className="wizbg__modes">
            {([
              ["auto", "Per-NFT auto"],
              ["fixed", "One colour"],
              ["none", "Studio"],
            ] as const).map(([m, label]) => (
              <button
                key={m}
                className={`btn btn--mini ${mode === m ? "btn--primary" : "btn--ghost"}`}
                onClick={() => {
                  if (mode !== m) {
                    patchWizard({ bgMode: m });
                    requeuePosters();
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "fixed" && (
            <div className="e3d__swatches">
              {BG_OPTIONS.map((o) => (
                <button
                  key={o.name}
                  className={`e3d__swatch ${bg.name === o.name ? "is-on" : ""}`}
                  style={{ background: o.color }}
                  title={o.name}
                  onClick={() => {
                    patchWizard({ background: o });
                    requeuePosters();
                  }}
                />
              ))}
            </div>
          )}
          <span className="e3d__bgname">
            {mode === "auto"
              ? "a soft milky colour of its own per NFT"
              : mode === "fixed"
                ? bg.name
                : "no background"}
            {wiz.items.some((i) => i.hasOwnBg) &&
              ` · ${wiz.items.filter((i) => i.hasOwnBg).length} with own background (kept as-is)`}
          </span>
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
            {is3d && (
              <button
                className={`wizitem__bg ${b.hasOwnBg ? "is-own" : ""}`}
                title={b.hasOwnBg ? "This file carries its own background — click if it should get one added instead" : "Click if this file already has its own background"}
                onClick={() => patchItem(b.id, { hasOwnBg: !b.hasOwnBg, status: b.status === "ready" ? "queued" : b.status })}
              >
                {b.bgHex && <i style={{ background: b.bgHex }} />}
                {b.hasOwnBg ? "own bg" : b.bgName || "bg: auto"}
              </button>
            )}
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
    // Items dropped AFTER the Souls step never went through its assignment, and
    // an unassigned item seals with no soul at all — silently, and forever.
    if (wiz.soulsOn && wiz.souls.length > 0 && getWizard().items.some((i) => !i.soulId)) {
      assignSouls();
    }
    if (!w.connected) return toast("Connect your wallet first", "err");
    if (!w.onBase) return toast("Switch to Base first", "err");
    if (!store.irys) return toast("Wallet not ready — try again in a moment", "err");

    const ok = await confirmDialog(
      "Seal on Irys — permanent",
      `Store <strong>${ready.length} item${ready.length === 1 ? "" : "s"}</strong> (${fmtBytes(totalBytes)}) forever on Irys, plus the drop manifest${soulsUsed.some((s) => bundlePathFor(s)) ? " and each soul's full-body bundle (soul + entire monorepo)" : ""}. Files under 100 KiB are free; the rest is paid from your Irys credit in Base ETH. Irreversible.`,
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
        const soulName = soulsUsed.find((s) => bundlePathFor(s) === path)?.name || "soul";
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
        // Every Irys upload is paid and permanent the instant it lands. A retry
        // after a mid-item failure must REUSE what already sealed, or the owner
        // pays twice for the same bytes — so progress is recorded per step.
        const prog: NonNullable<WizItem["up"]> = { ...(b.up ?? {}) };
        const item = prog.item ?? uid();
        prog.item = item;
        const saveProg = () => patchItem(b.id, { up: { ...prog } });
        saveProg();
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
          let modelUp: { id: string; url: string } | null = prog.model ?? null;
          if (is3d && b.glb && !modelUp) {
            setStepTxt(`Sealing ${b.name} (${edition}/${ready.length}) — glb…`);
            const up = await uploadData(store.irys, b.glb, "model/gltf-binary", tags("model", b.name, [
              { name: "Animated", value: (b.clips ?? 0) > 0 ? "true" : "false" },
            ]));
            modelUp = { id: up.id, url: up.url };
            prog.model = modelUp;
            saveProg();
          }
          let imageUp: { id: string; url: string } | null = prog.image ?? null;
          if (b.poster && !imageUp) {
            setStepTxt(`Sealing ${b.name} — image…`);
            const up = await uploadData(store.irys, await blobToBytes(b.poster), b.poster.type || "image/png", tags("final", b.name));
            imageUp = { id: up.id, url: up.url };
            prog.image = imageUp;
            saveProg();
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
          // Background is PER ITEM — the launch lesson: one colour repeated over a
          // whole collection reads broken on the marketplace grid.
          if (is3d && b.bgHex && b.bgName) attributes.push({ trait_type: "Background", value: b.bgName });
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
            // the poster may be a supplied JPEG rather than a captured PNG —
            // the manifest path's extension must tell the truth about the bytes
            const posterName = posterPathFor(b.poster);
            let manId = prog.manifest?.id;
            if (!manId) {
              const paths: Record<string, { id: string }> = {};
              if (imageUp) paths[posterName] = { id: imageUp.id };
              if (modelUp) paths["model.glb"] = { id: modelUp.id };
              const manifest = { manifest: "arweave/paths", version: "0.1.0", ...(imageUp ? { index: { path: posterName } } : {}), paths };
              setStepTxt(`Sealing ${b.name} — media manifest…`);
              const manUp = await uploadData(store.irys, new TextEncoder().encode(JSON.stringify(manifest)),
                "application/x.arweave-manifest+json", tags("media-manifest", `${b.name} — media manifest`));
              manId = manUp.id;
              prog.manifest = { id: manId };
              saveProg();
            }
            if (imageUp) {
              imgGw = `${GATEWAY}/${manId}/${posterName}`;
              imgFinal = prog.imgFinal ?? (await resolveWithRetry(imgGw));
              prog.imgGw = imgGw;
              prog.imgFinal = imgFinal;
            }
            if (modelUp) {
              animGw = `${GATEWAY}/${manId}/model.glb`;
              animFinal = prog.animFinal ?? (await resolveWithRetry(animGw));
              prog.animGw = animGw;
              prog.animFinal = animFinal;
            }
            saveProg();
          }
          const meta = buildMetadata({
            name: b.name,
            description: wiz.description,
            image: imgFinal || animFinal || "",
            animation_url: animFinal,
            background_color: is3d ? (b.bgHex ?? undefined) : undefined,
            attributes,
            ai_soul: soul
              ? (buildAiSoul(
                  soul,
                  item.slice(0, 8),
                  undefined,
                  bundlePathFor(soul) ? monorepoByPath.get(bundlePathFor(soul)!) : undefined,
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

      // The drop manifest maps tokenId → metadata BY POSITION, so it must list
      // every sealed item in item order — including ones sealed in an earlier
      // run. Building it from this run alone renumbered the whole collection and
      // pointed token #1 at whatever happened to be sealed last.
      const allSealed = getWizard().items.filter((i) => i.status === "sealed" && i.sealed?.metadataId);
      const stillNot = getWizard().items.filter((i) => i.status !== "sealed");
      if (allSealed.length > 0) {
        let go = true;
        if (stillNot.length > 0) {
          go = await confirmDialog(
            "Seal the drop manifest?",
            `<strong>${allSealed.length}</strong> item${allSealed.length === 1 ? " is" : "s are"} sealed, but <strong>${stillNot.length}</strong> did not seal. The manifest numbers tokens 1…${allSealed.length} over the sealed items only — the rest would need a new manifest later. Seal it anyway?`,
            "Seal manifest",
          );
        }
        if (go) {
          setStepTxt("Sealing drop manifest…");
          const man = await sealDropManifest(
            store.irys,
            allSealed.map((i) => i.sealed!.metadataId),
            collection || "collection",
          );
          setDropManifestUri(man.baseURI);
          patchWizard({ sealBaseURI: man.baseURI, sealedAt: Date.now() });
          toast(`Sealed ${metadataIds.length} items — ${allSealed.length} in the manifest`, "ok");
        }
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
