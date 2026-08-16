// Load FBX / GLB / GLTF / OBJ in the browser → a normalized THREE object +
// animation clips, and export back to a single binary glb (animation preserved).
// No native deps: pure three.js, runs entirely client-side.
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { MeshoptDecoder } from "meshoptimizer";

let _gltfLoader: GLTFLoader | null = null;
/** GLTFLoader with the meshopt decoder wired so it can read optimized glb too. */
async function gltfLoader(): Promise<GLTFLoader> {
  if (_gltfLoader) return _gltfLoader;
  await MeshoptDecoder.ready;
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  _gltfLoader = l;
  return l;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export interface ModelStats {
  meshes: number;
  triangles: number;
  vertices: number;
  animations: number;
  textures: number;
}

export interface LoadedModel {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  stats: ModelStats;
}

const SUPPORTED = ["fbx", "glb", "gltf", "obj"] as const;
export type SupportedExt = (typeof SUPPORTED)[number];

/** A backdrop baked INTO the model (iCLONE pipeline: an inward-facing unlit dome
 * around the figure). Carried in the file so the colour survives any viewer. */
export interface BakedBackdrop {
  /** Field colour at the centre of the dome (6-hex, no #). */
  hex: string;
  /** Colour at the dome's rim — what page/viewer corners should be. */
  rim: string;
}

/** True for the dome mesh/node of a baked backdrop (never part of the figure). */
export function isBackdropNode(name: string | undefined | null): boolean {
  return !!name && name.indexOf("Backdrop") >= 0;
}

/**
 * Detect a baked backdrop by reading the GLB's JSON chunk directly — no three.js
 * parse needed, so Upload can badge files the moment they are dropped.
 */
export function detectBakedBackdrop(buf: ArrayBuffer): BakedBackdrop | null {
  try {
    const dv = new DataView(buf);
    if (buf.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) return null;
    const jlen = dv.getUint32(12, true);
    if (dv.getUint32(16, true) !== 0x4e4f534a) return null;
    const js = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jlen)));
    const nodes: { name?: string; extras?: Record<string, unknown> }[] = js.nodes ?? [];
    for (const n of nodes) {
      const ex = n.extras;
      if (!ex || !isBackdropNode(n.name)) continue;
      const hex = typeof ex.hex === "string" && /^[0-9a-f]{6}$/i.test(ex.hex) ? ex.hex : null;
      if (!hex) continue;
      const rim = typeof ex.rim_hex === "string" && /^[0-9a-f]{6}$/i.test(ex.rim_hex) ? ex.rim_hex : hex;
      return { hex, rim };
    }
    return null;
  } catch {
    return null;
  }
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function isSupported(name: string): boolean {
  return (SUPPORTED as readonly string[]).includes(extOf(name));
}

/** Parse a dropped model file fully in-browser. */
export async function loadModelFile(file: File): Promise<LoadedModel> {
  const ext = extOf(file.name);
  const buf = await file.arrayBuffer();
  let object: THREE.Object3D;
  let animations: THREE.AnimationClip[] = [];

  if (ext === "fbx") {
    object = new FBXLoader().parse(buf, "");
    animations = ((object as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations ?? []).slice();
  } else if (ext === "glb" || ext === "gltf") {
    const gltf = await (await gltfLoader()).parseAsync(buf, "");
    object = gltf.scene;
    animations = (gltf.animations ?? []).slice();
  } else if (ext === "obj") {
    object = new OBJLoader().parse(new TextDecoder().decode(buf));
  } else {
    throw new Error(`Unsupported format ".${ext}" — use FBX, GLB, GLTF or OBJ.`);
  }

  makeInPlace(animations); // run/walk in place — never drift out of frame
  normalizeObject(object);
  return { object, animations, stats: computeStats(object, animations) };
}

/**
 * Strip root motion so the character animates *in place* — Mixamo clips often
 * translate the hips forward (running/walking), which would drift the figure out
 * of frame (and out of the minted animation). We lock the root track's X/Z to its
 * first keyframe while keeping Y (so the natural vertical bob survives).
 */
export function makeInPlace(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  const horizTravel = (t: THREE.KeyframeTrack): number => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.values.length; i += 3) {
      const x = t.values[i]!;
      const z = t.values[i + 2]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return maxX - minX + (maxZ - minZ);
  };

  for (const clip of clips) {
    const posTracks = clip.tracks.filter((t) => t.name.endsWith(".position") && t.values.length >= 6);
    if (!posTracks.length) continue;
    // the root-motion track is the hips/root (or, failing a name match, the one
    // that travels horizontally the most — other bones are rotation-only).
    let root = posTracks.find((t) => /hips|root|armature/i.test(t.name));
    if (!root) root = posTracks.reduce((a, b) => (horizTravel(b) > horizTravel(a) ? b : a));
    const v = root.values;
    const x0 = v[0]!;
    const z0 = v[2]!;
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
  return clips;
}

/** Bounding box of the FIGURE only — a baked backdrop dome would otherwise win
 * every measurement and the character ends up tiny, floating, or cut. */
function figureBox(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || isBackdropNode(mesh.name) || isBackdropNode(mesh.parent?.name)) return;
    box.expandByObject(mesh);
  });
  if (box.isEmpty()) box.setFromObject(object);
  return box;
}

/** Center on X/Z, drop feet to y=0, scale to a consistent height, enable shadows. */
export function normalizeObject(object: THREE.Object3D, targetHeight = 2.4): void {
  object.updateWorldMatrix(true, true);
  const size = figureBox(object).getSize(new THREE.Vector3());
  const s = targetHeight / (size.y || 1);
  object.scale.multiplyScalar(s);

  object.updateWorldMatrix(true, true);
  const box = figureBox(object);
  const c = box.getCenter(new THREE.Vector3());
  object.position.x -= c.x;
  object.position.z -= c.z;
  object.position.y -= box.min.y;

  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (isBackdropNode(mesh.name) || isBackdropNode(mesh.parent?.name)) {
      // the dome is unlit by design — converting it to a lit material would
      // shade the field and shift its colour; leave it exactly as authored
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      return;
    }
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const converted = mats.map(toStandardMaterial);
    mesh.material = Array.isArray(mesh.material) ? converted : converted[0]!;
  });
}

/**
 * Convert Phong/Lambert/Basic (what FBX/OBJ loaders emit) to MeshStandardMaterial.
 * glTF is PBR — exporting Standard gives correct output and avoids the exporter
 * stalling/degrading on legacy materials. Preserves the baked map + color.
 */
function toStandardMaterial(m: THREE.Material | undefined): THREE.Material {
  if (!m) return new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.05 });
  if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    const std = m as THREE.MeshStandardMaterial;
    if (std.roughness === 1 || std.roughness === undefined) std.roughness = 0.6;
    if (std.metalness === undefined) std.metalness = 0.05;
    if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
    return std;
  }
  const src = m as THREE.MeshPhongMaterial & { color?: THREE.Color };
  const std = new THREE.MeshStandardMaterial({
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    map: src.map ?? null,
    normalMap: src.normalMap ?? null,
    aoMap: src.aoMap ?? null,
    emissiveMap: src.emissiveMap ?? null,
    emissive: src.emissive ? src.emissive.clone() : new THREE.Color(0x000000),
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    side: src.side,
    vertexColors: src.vertexColors,
    roughness: 0.6,
    metalness: 0.05,
  });
  if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
  std.name = src.name;
  return std;
}

const TEX_KEYS = ["map", "normalMap", "emissiveMap", "aoMap", "roughnessMap", "metalnessMap"] as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function imgDims(img: unknown): { w: number; h: number } {
  const a = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return { w: a?.naturalWidth || a?.width || 0, h: a?.naturalHeight || a?.height || 0 };
}

/**
 * Poll until a texture's image actually has pixels. Embedded FBX textures attach
 * their image asynchronously (and `tex.image` is even null for a beat), so the
 * exporter would otherwise throw "No valid image data found".
 */
async function waitForTextureImage(tex: THREE.Texture, timeoutMs = 15_000): Promise<unknown | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const img = tex.image as unknown;
    if (img) {
      if (typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement) {
        if (img.naturalWidth > 0) return img;
        try {
          await img.decode();
        } catch {
          /* keep polling */
        }
      } else if (imgDims(img).w > 0) {
        return img; // canvas / ImageBitmap / ImageData
      }
    }
    await sleep(50);
  }
  return tex.image ?? null;
}

/**
 * Wait for each material texture to load, then re-bake it onto a canvas —
 * guaranteed-valid pixels the GLTFExporter reads reliably (fixes embedded-FBX
 * textures failing with "No valid image data found").
 */
async function prepareTexturesForExport(object: THREE.Object3D): Promise<void> {
  const textures = new Set<THREE.Texture>();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      for (const key of TEX_KEYS) {
        const tex = (m as unknown as Record<string, THREE.Texture | null>)[key];
        if (tex) textures.add(tex);
      }
    }
  });

  for (const tex of textures) {
    const img = await waitForTextureImage(tex);
    if (!img) continue;
    if (typeof HTMLCanvasElement !== "undefined" && img instanceof HTMLCanvasElement) continue;
    const { w, h } = imgDims(img);
    if (!w || !h) continue;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
    tex.image = canvas;
    tex.needsUpdate = true;
  }
}

function computeStats(object: THREE.Object3D, animations: THREE.AnimationClip[]): ModelStats {
  let meshes = 0;
  let triangles = 0;
  let vertices = 0;
  const textures = new Set<string>();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes++;
    const g = mesh.geometry;
    const pos = g.getAttribute("position");
    const vcount = pos ? pos.count : 0;
    vertices += vcount;
    triangles += g.index ? g.index.count / 3 : vcount / 3;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const map = (m as THREE.MeshStandardMaterial)?.map;
      if (map?.uuid) textures.add(map.uuid);
    }
  });
  return { meshes, triangles: Math.round(triangles), vertices, animations: animations.length, textures: textures.size };
}

/** Export the (possibly animated) object to a single binary glb. */
export async function exportGLB(object: THREE.Object3D, animations: THREE.AnimationClip[]): Promise<Uint8Array> {
  await prepareTexturesForExport(object);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("GLB export timed out (60s) — model too heavy or a texture failed to decode.")), 60_000);
    new GLTFExporter().parse(
      object,
      (result) => {
        clearTimeout(timer);
        if (result instanceof ArrayBuffer) resolve(new Uint8Array(result));
        else reject(new Error("GLB export did not return binary output."));
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
      { binary: true, animations, onlyVisible: true, includeCustomExtensions: true },
    );
  });
}

export interface GLBValidation {
  ok: boolean;
  animations: number;
  meshes: number;
  error?: string;
}

/**
 * Re-load a glb through GLTFLoader (with meshopt decoder) to prove it is valid
 * and renderable before we ever seal/charge for it — same loader family that
 * OpenSea / model-viewer use, so a pass here means it will display there.
 */
export async function validateGLB(bytes: Uint8Array): Promise<GLBValidation> {
  try {
    const gltf = await (await gltfLoader()).parseAsync(toArrayBuffer(bytes), "");
    let meshes = 0;
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    return { ok: meshes > 0, animations: gltf.animations?.length ?? 0, meshes };
  } catch (e) {
    return { ok: false, animations: 0, meshes: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
