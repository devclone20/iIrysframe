// Optimize a glb fully in-browser: clean the graph, compress geometry with
// meshopt, and downscale + re-encode textures to WebP via canvas. Every stage
// degrades gracefully — if a compressor is unavailable the raw bytes still flow.
import { WebIO, type Document, getBounds } from "@gltf-transform/core";
import { EXTMeshoptCompression, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, weld, quantize, resample, reorder, center, dequantize } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

export interface OptimizeOptions {
  maxTexture?: number; // longest texture edge, px
  quality?: number; // WebP quality 0..1
  meshCompression?: boolean;
}

export interface OptimizeResult {
  bytes: Uint8Array;
  before: number;
  after: number;
}

export async function optimizeGLB(input: Uint8Array, opts: OptimizeOptions = {}): Promise<OptimizeResult> {
  const maxTexture = opts.maxTexture ?? 2048;
  const quality = opts.quality ?? 0.85;
  const useMeshopt = opts.meshCompression ?? true;
  const before = input.byteLength;

  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);

  const io = new WebIO().registerExtensions([EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });

  const doc = await io.readBinary(input);

  // 1 — graph hygiene + animation keyframe cleanup (safe, always run)
  try {
    await doc.transform(dedup(), prune(), weld(), resample());
  } catch {
    /* keep going with the un-pruned graph */
  }

  // 2 — texture downscale + WebP (canvas; browser-native, no sharp)
  try {
    await downscaleTextures(doc, maxTexture, quality);
  } catch {
    /* keep original textures */
  }

  // 3 — geometry compression (meshopt). quantize+reorder then mark the extension.
  // NOTE: EXT_meshopt_compression lands in `extensionsRequired`, and marketplace
  // viewers (OpenSea, model-viewer) ship WITHOUT the meshopt decoder — they fail
  // to parse. useMeshopt=false is the marketplace-safe path; it also TRANSCODES
  // meshopt inputs back to plain glb (the read above already decompressed them).
  if (!useMeshopt) {
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      if (ext.extensionName === "EXT_meshopt_compression") ext.dispose();
    }
  }
  if (useMeshopt) {
    try {
      await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize());
      doc
        .createExtension(EXTMeshoptCompression)
        .setRequired(true)
        .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
    } catch {
      /* uncompressed geometry still valid */
    }
  }

  const bytes = await io.writeBinary(doc);
  return { bytes, before, after: bytes.byteLength };
}

export interface RecenterResult {
  bytes: Uint8Array;
  before: number;
  after: number;
  /** How far the model's bounding-box center sat from the origin (world units). */
  offset: [number, number, number];
  moved: boolean;
}

/** Neutralize a static translation offset on the skeleton ROOT bone's animation.
 *  Mixamo clips routinely pin the hips a constant amount above their rest
 *  position (the Catwalk clip lifts them ~1.2 world units). model-viewer frames
 *  the camera on the NON-skinned bind pose (centered) but renders the ANIMATED
 *  pose — so that hip lift pushes the whole figure up and out of the top of the
 *  pane. A rigid recenter can't fix it (both poses move together); the offset
 *  lives in the animation. We rebase the root-bone translation keyframes around
 *  the bone's rest position, preserving any real motion (deviation from mean)
 *  while removing the static drift. Returns the largest world drift removed. */
function neutralizeRootDrift(doc: Document): number {
  const root = doc.getRoot();
  const skins = root.listSkins();
  if (!skins.length) return 0;

  const parent = new Map<object, any>();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parent.set(c, n);
  const worldScaleY = (node: any): number => {
    let s = 1;
    let n: any = node;
    while (n) {
      s *= n.getScale()[1];
      n = parent.get(n);
    }
    return s;
  };
  const rootJointOf = (skin: any): any => {
    const joints: any[] = skin.listJoints();
    const jset = new Set(joints);
    return joints.find((j) => { const p = parent.get(j); return !p || !jset.has(p); }) ?? joints[0];
  };
  const rootJoints = new Map<any, number>();
  for (const s of skins) { const rj = rootJointOf(s); if (rj) rootJoints.set(rj, worldScaleY(rj)); }

  let maxDrift = 0;
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== "translation") continue;
      const tn = ch.getTargetNode();
      if (!tn || !rootJoints.has(tn)) continue;
      const sampler = ch.getSampler();
      const out = sampler?.getOutput();
      if (!sampler || !out) continue;
      const arr = out.getArray();
      if (!arr || arr.length < 3) continue;
      const n = arr.length / 3;
      let mx = 0, my = 0, mz = 0;
      for (let i = 0; i < arr.length; i += 3) { mx += arr[i]!; my += arr[i + 1]!; mz += arr[i + 2]!; }
      mx /= n; my /= n; mz /= n;
      const rest = tn.getTranslation();
      const dx = mx - rest[0], dy = my - rest[1], dz = mz - rest[2];
      if (Math.hypot(dx, dy, dz) < 0.01) continue;
      const copy = arr.slice();
      for (let i = 0; i < arr.length; i += 3) { copy[i] -= dx; copy[i + 1] -= dy; copy[i + 2] -= dz; }
      sampler.setOutput(out.clone().setArray(copy));
      maxDrift = Math.max(maxDrift, Math.abs(dy) * (rootJoints.get(tn) ?? 1));
    }
  }
  return maxDrift;
}

/** Recenter a glb so the ANIMATED figure sits dead-center in the frame.
 *  Two independent offsets can push a figure out of the pane on OpenSea /
 *  model-viewer: (1) the bind-pose bounding box being off-origin (a root
 *  translation), and (2) the animation lifting the skeleton root above its rest
 *  position. We fix both — rebase the root-bone animation to its rest position,
 *  then center the bind bounding box on the origin — and transcode any meshopt/
 *  quantized geometry back to plain glb so marketplace viewers can parse it.
 *  Operates on the already-sealed glb; no original file needed. */
export async function recenterGLB(input: Uint8Array): Promise<RecenterResult> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new WebIO().registerExtensions([EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });
  const before = input.byteLength;
  const doc = await io.readBinary(input);

  // Drop meshopt (marketplace viewers can't decode it) and dequantize so bounds
  // and keyframes are read in real world units, not packed integer ranges.
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === "EXT_meshopt_compression") ext.dispose();
  }
  try {
    await doc.transform(dequantize());
  } catch {
    /* geometry was not quantized */
  }

  // (2) rebase the animated root bone to its rest position (fixes the hip lift).
  const animDrift = neutralizeRootDrift(doc);

  // (1) measure + center the bind-pose bounding box on the origin.
  const scene = doc.getRoot().listScenes()[0];
  const b = scene ? getBounds(scene) : null;
  const offset: [number, number, number] = b
    ? [
        (b.max[0] + b.min[0]) / 2,
        (b.max[1] + b.min[1]) / 2,
        (b.max[2] + b.min[2]) / 2,
      ]
    : [0, 0, 0];

  await doc.transform(prune(), center({ pivot: "center" }));

  const bytes = await io.writeBinary(doc);
  // fold the corrected hip lift into the Y axis so callers report the real drift
  const reported: [number, number, number] = [offset[0], Math.max(Math.abs(offset[1]), animDrift), offset[2]];
  const moved = Math.max(Math.abs(offset[0]), reported[1], Math.abs(offset[2])) > 0.01;
  return { bytes, before, after: bytes.byteLength, offset: reported, moved };
}

async function downscaleTextures(doc: Document, maxSize: number, quality: number): Promise<void> {
  const textures = doc.getRoot().listTextures();
  if (!textures.length) return;
  let usedWebP = false;

  for (const tex of textures) {
    const image = tex.getImage();
    const mime = tex.getMimeType();
    if (!image || !mime) continue;

    const bitmap = await createImageBitmap(new Blob([image as BlobPart], { type: mime }));
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxSize / longest);
    const alreadyOptimal = scale >= 1 && mime === "image/webp";
    if (alreadyOptimal) {
      bitmap.close();
      continue;
    }

    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      continue;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
    if (!blob) continue;
    const buf = new Uint8Array(await blob.arrayBuffer());
    tex.setImage(buf).setMimeType("image/webp");
    usedWebP = true;
  }

  if (usedWebP) doc.createExtension(EXTTextureWebP).setRequired(false);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
