// The Create wizard's single source of truth. One store drives the whole
// guided flow — every step reads and writes here, the Launch tab consumes the
// result. Choices persist across reloads (files/bytes are session-only).

import { useEffect, useState } from "react";
import type { SoulConfig } from "../soul";
import { SOUL_PRESETS } from "../soul";
import { DEFAULT_NAMING, type NamingConfig } from "./naming";
import { saveItems, loadItems, clearStoredItems } from "./itemsDb";

export type ArtKind = "3d" | "2d";
export type Scope = "collection" | "single" | "layers"; // layers = 2D generative
export type LaunchMode = "iirys-opensea" | "opensea-console";
export type SoulAssign = "single" | "mixed";

export const STEP_IDS = ["type", "launch", "contract", "upload", "souls", "naming", "process", "seal"] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_META: Record<StepId, { label: string; hint: string }> = {
  type: { label: "Type", hint: "2D or 3D · collection, single or layers" },
  launch: { label: "Launch", hint: "how it reaches collectors" },
  contract: { label: "Contract", hint: "network, royalties, supply, deploy" },
  upload: { label: "Assets", hint: "load your art" },
  souls: { label: "Souls", hint: "one soul or a random mix" },
  naming: { label: "Names", hint: "collection + item naming" },
  process: { label: "Process", hint: "optimize · posters · rarity" },
  seal: { label: "Seal", hint: "permanent on Irys" },
};

export type WizStatus = "queued" | "processing" | "ready" | "sealing" | "sealed" | "error";

export interface WizItem {
  id: string;
  file?: File; // 3D model or 2D image
  sourceName: string;
  name: string; // final assigned name (naming step)
  size: number;
  status: WizStatus;
  error?: string;
  // 3d
  glb?: Uint8Array;
  before?: number;
  after?: number;
  tris?: number;
  clips?: number;
  // shared
  poster?: Blob; // 3d capture · 2d = the image itself
  posterUrl?: string;
  attributes?: { trait_type: string; value: string | number }[]; // 2D generative traits
  tier?: string;
  soulId?: string;
  sealed?: { model: string | null; image: string | null; metadata: string; metadataId: string };
}

export interface WizSoul extends SoulConfig {
  id: string;
}

interface WizardState {
  step: StepId;
  kind: ArtKind | null;
  scope: Scope | null;
  launch: LaunchMode | null;
  contractSkipped: boolean;
  items: WizItem[];
  souls: WizSoul[];
  soulAssign: SoulAssign;
  soulsOn: boolean;
  naming: NamingConfig;
  description: string;
  background: { name: string; color: string | null };
  sealBaseURI: string | null; // drop manifest of THIS collection
  sealedAt: number | null;
}

const KEY = "iirys.wizard.v1";
const uid = () => crypto.randomUUID();

function defaultSouls(): WizSoul[] {
  return [{ ...SOUL_PRESETS.iCLONE, id: uid() }];
}

function loadPersisted(): Partial<WizardState> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return {};
    return {
      step: STEP_IDS.includes(raw.step) ? raw.step : "type",
      kind: raw.kind ?? null,
      scope: raw.scope ?? null,
      launch: raw.launch ?? null,
      contractSkipped: !!raw.contractSkipped,
      souls: Array.isArray(raw.souls) && raw.souls.length ? raw.souls : defaultSouls(),
      soulAssign: raw.soulAssign === "mixed" ? "mixed" : "single",
      soulsOn: raw.soulsOn !== false,
      naming: { ...DEFAULT_NAMING, ...(raw.naming ?? {}) },
      description: typeof raw.description === "string" ? raw.description : "",
      background: raw.background ?? { name: "Milk Rose", color: "#F7D9E3" },
    };
  } catch {
    return {};
  }
}

let state: WizardState = {
  step: "type",
  kind: null,
  scope: null,
  launch: null,
  contractSkipped: false,
  items: [],
  souls: defaultSouls(),
  soulAssign: "single",
  soulsOn: true,
  naming: { ...DEFAULT_NAMING },
  description: "",
  background: { name: "Milk Rose", color: "#F7D9E3" },
  sealBaseURI: null,
  sealedAt: null,
  ...loadPersisted(),
};

const subs = new Set<() => void>();

function persist() {
  try {
    const { step, kind, scope, launch, contractSkipped, souls, soulAssign, soulsOn, naming, description, background } = state;
    localStorage.setItem(
      KEY,
      JSON.stringify({ step, kind, scope, launch, contractSkipped, souls, soulAssign, soulsOn, naming, description, background }),
    );
  } catch {
    /* quota */
  }
}

function emit() {
  persist();
  saveItems(state.items); // processed bytes survive reloads (IndexedDB)
  subs.forEach((s) => s());
}

// rehydrate processed items after a reload (async, non-blocking)
void loadItems().then((items) => {
  if (items.length > 0 && state.items.length === 0) {
    state = { ...state, items };
    subs.forEach((s) => s());
  }
});

export function getWizard(): WizardState {
  return state;
}

export function useWizard(): WizardState {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((x) => x + 1);
    subs.add(s);
    return () => {
      subs.delete(s);
    };
  }, []);
  return state;
}

export function patchWizard(patch: Partial<WizardState>) {
  state = { ...state, ...patch };
  emit();
}

export function goStep(step: StepId) {
  patchWizard({ step });
}

// ── items ────────────────────────────────────────────────────────────────────
export function addFiles(files: File[]) {
  const items: WizItem[] = files.map((file) => ({
    id: uid(),
    file,
    sourceName: file.name,
    name: file.name.replace(/\.[^.]+$/, ""),
    size: file.size,
    status: "queued",
  }));
  state = { ...state, items: [...state.items, ...items], sealBaseURI: null, sealedAt: null };
  emit();
}

/** 2D generative bridge: adopt composed items from the layers engine. */
export function adoptGenerated(items: WizItem[]) {
  state.items.forEach((i) => i.posterUrl && URL.revokeObjectURL(i.posterUrl));
  state = { ...state, items, sealBaseURI: null, sealedAt: null };
  emit();
}

export function patchItem(id: string, patch: Partial<WizItem>) {
  state = { ...state, items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
  emit();
}

export function removeItem(id: string) {
  const it = state.items.find((i) => i.id === id);
  if (it?.posterUrl) URL.revokeObjectURL(it.posterUrl);
  state = { ...state, items: state.items.filter((i) => i.id !== id) };
  emit();
}

export function clearItems() {
  state.items.forEach((i) => i.posterUrl && URL.revokeObjectURL(i.posterUrl));
  state = { ...state, items: [], sealBaseURI: null, sealedAt: null };
  void clearStoredItems();
  emit();
}

export function setItemNames(names: string[]) {
  state = { ...state, items: state.items.map((it, i) => ({ ...it, name: names[i] ?? it.name })) };
  emit();
}

// ── souls ────────────────────────────────────────────────────────────────────
export function addSoul(from?: SoulConfig): WizSoul {
  const soul: WizSoul = { ...(from ?? SOUL_PRESETS.Custom), id: uid() };
  state = { ...state, souls: [...state.souls, soul] };
  emit();
  return soul;
}

export function patchSoul(id: string, patch: Partial<SoulConfig>) {
  state = { ...state, souls: state.souls.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
  emit();
}

export function removeSoul(id: string) {
  if (state.souls.length <= 1) return; // keep at least one
  state = {
    ...state,
    souls: state.souls.filter((s) => s.id !== id),
    items: state.items.map((i) => (i.soulId === id ? { ...i, soulId: undefined } : i)),
  };
  emit();
}

/** Assign souls to items: single = first soul everywhere; mixed = seeded random. */
export function assignSouls() {
  const souls = state.souls;
  if (souls.length === 0) return;
  if (state.soulAssign === "single") {
    state = { ...state, items: state.items.map((i) => ({ ...i, soulId: souls[0]!.id })) };
  } else {
    let s = state.naming.seed >>> 0;
    const rand = () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    state = {
      ...state,
      items: state.items.map((i) => ({ ...i, soulId: souls[Math.floor(rand() * souls.length)]!.id })),
    };
  }
  emit();
}

// ── step gating ──────────────────────────────────────────────────────────────
export function stepDone(step: StepId): boolean {
  const s = state;
  switch (step) {
    case "type":
      return s.kind != null && s.scope != null;
    case "launch":
      return s.launch != null;
    case "contract":
      return s.contractSkipped || hasDeployedContract();
    case "upload":
      return s.items.length > 0;
    case "souls":
      return !s.soulsOn || s.items.every((i) => i.soulId) || s.items.length === 0 ? s.souls.length > 0 : false;
    case "naming":
      return !!s.naming.collection.trim();
    case "process":
      return s.items.length > 0 && s.items.every((i) => i.status === "ready" || i.status === "sealed");
    case "seal":
      return s.sealedAt != null;
  }
}

function hasDeployedContract(): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem("iirys.forge.v1") ?? "{}");
    return Array.isArray(raw.deployed) && raw.deployed.length > 0;
  } catch {
    return false;
  }
}

/** First step that still needs attention (the wizard's "you are here"). */
export function nextPending(): StepId {
  for (const id of STEP_IDS) if (!stepDone(id)) return id;
  return "seal";
}

export function resetWizard() {
  clearItems();
  state = {
    ...state,
    step: "type",
    kind: null,
    scope: null,
    launch: null,
    contractSkipped: false,
    sealBaseURI: null,
    sealedAt: null,
  };
  emit();
}
