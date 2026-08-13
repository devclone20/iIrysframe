// Shared state between the 3D NFT tab (batch collections) and the ENGINE tab
// (rarity, drop plan, contract deploys). External store + subscribers (same
// pattern as profile.ts) so both tabs stay in sync without prop drilling.

import { useEffect, useState } from "react";
import { BASE, TIERS } from "../config";

// ── batch (a 3D collection loaded in the 3D NFT tab) ─────────────────────────
export type BatchStatus = "queued" | "processing" | "ready" | "sealing" | "sealed" | "error";

export interface BatchItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: BatchStatus;
  error?: string;
  tris?: number;
  clips?: number;
  glb?: Uint8Array; // optimized (or raw when optimize was skipped/failed)
  before?: number;
  after?: number;
  poster?: Blob;
  posterUrl?: string;
  tier?: string; // rarity tier (assigned in ENGINE, sealed as attribute + tag)
  sealed?: { model: string; poster: string | null; metadata: string };
}

// ── drop plan (ENGINE) ────────────────────────────────────────────────────────
export interface TierShare {
  name: string;
  pct: number;
}

export interface DropConfig {
  supplyMode: "fixed" | "open"; // fixed = exactly N items; open = public drop limit
  maxSupply: number; // 0 = unlimited (open mode custom cap)
  editionsPerItem: number; // fixed copies minted per item (owner mint)
  publicMint: boolean;
  priceEth: string; // per public mint
  walletLimit: number; // 0 = unlimited
  ogGated: boolean;
  ogAddress: string; // the OG card ERC-721 on Base
  royaltyBps: number; // 500 = 5%
  devSupportMode: "none" | "first" | "perpetual"; // optional developer-support fee
  devBps: number; // 0, or 100..500 (UI: 1..5%)
  rarityMode: "auto" | "manual";
  tiers: TierShare[];
}

export interface DeployedContract {
  address: string;
  name: string;
  symbol: string;
  txHash: string;
  chainId: number;
  at: number; // timestamp
}

export interface CollectionProfile {
  name: string;
  description: string;
  externalLink: string;
  imageUrl: string; // gateway link (e.g. a sealed poster)
  sealedUri?: string; // Irys link of the sealed profile JSON (→ contractURI)
}

interface ForgeState {
  batch: BatchItem[];
  drop: DropConfig;
  profile: CollectionProfile;
  deployed: DeployedContract[];
  active: string | null; // active contract address (mint target)
  dropManifestUri: string | null; // sealed drop manifest baseURI (gateway/{id}/)
  editionsByMeta: Record<string, number>; // per-item mint limit (metadataId → editions)
}

const KEY = "iirys.forge.v1";

const DEFAULT_DROP: DropConfig = {
  supplyMode: "fixed",
  maxSupply: 0,
  editionsPerItem: 1,
  publicMint: false,
  priceEth: "0",
  walletLimit: 0,
  ogGated: false,
  ogAddress: "",
  royaltyBps: 500,
  devSupportMode: "none",
  devBps: 0,
  rarityMode: "auto",
  tiers: [
    { name: TIERS[0], pct: 70 },
    { name: TIERS[1], pct: 25 },
    { name: TIERS[2], pct: 5 },
  ],
};

const DEFAULT_PROFILE: CollectionProfile = {
  name: "iCLONE Genesis",
  description: "",
  externalLink: "https://cloneframe.io",
  imageUrl: "",
};

function loadPersisted(): Pick<ForgeState, "drop" | "profile" | "deployed" | "active" | "dropManifestUri" | "editionsByMeta"> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw === "object") {
      return {
        drop: { ...DEFAULT_DROP, ...(raw.drop ?? {}) },
        profile: { ...DEFAULT_PROFILE, ...(raw.profile ?? {}) },
        deployed: Array.isArray(raw.deployed) ? raw.deployed : [],
        active: typeof raw.active === "string" ? raw.active : null,
        dropManifestUri: typeof raw.dropManifestUri === "string" ? raw.dropManifestUri : null,
        editionsByMeta: raw.editionsByMeta && typeof raw.editionsByMeta === "object" ? raw.editionsByMeta : {},
      };
    }
  } catch {
    /* fresh start */
  }
  return { drop: { ...DEFAULT_DROP }, profile: { ...DEFAULT_PROFILE }, deployed: [], active: null, dropManifestUri: null, editionsByMeta: {} };
}

let state: ForgeState = { batch: [], ...loadPersisted() };
const subs = new Set<() => void>();

function persist() {
  try {
    const { drop, profile, deployed, active, dropManifestUri, editionsByMeta } = state;
    localStorage.setItem(KEY, JSON.stringify({ drop, profile, deployed, active, dropManifestUri, editionsByMeta }));
  } catch {
    /* quota */
  }
}

function emit() {
  subs.forEach((s) => s());
}

export function getForge(): ForgeState {
  return state;
}

export function useForge(): ForgeState {
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

// ── batch ops ────────────────────────────────────────────────────────────────
export function setBatch(items: BatchItem[]) {
  state.batch.forEach((b) => b.posterUrl && URL.revokeObjectURL(b.posterUrl));
  state = { ...state, batch: items };
  emit();
}

export function patchBatchItem(id: string, patch: Partial<BatchItem>) {
  state = { ...state, batch: state.batch.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
  emit();
}

export function clearBatch() {
  setBatch([]);
}

// ── drop / profile / contracts ───────────────────────────────────────────────
export function patchDrop(patch: Partial<DropConfig>) {
  state = { ...state, drop: { ...state.drop, ...patch } };
  persist();
  emit();
}

export function patchProfile(patch: Partial<CollectionProfile>) {
  state = { ...state, profile: { ...state.profile, ...patch } };
  persist();
  emit();
}

export function addDeployed(d: DeployedContract) {
  state = { ...state, deployed: [d, ...state.deployed], active: d.address };
  persist();
  emit();
}

export function setActiveContract(address: string | null) {
  state = { ...state, active: address };
  persist();
  emit();
}

export function setDropManifestUri(uri: string | null) {
  state = { ...state, dropManifestUri: uri };
  persist();
  emit();
}

/** The contract the app mints against: user-deployed active, else the env one. */
export function activeMintContract(): string | null {
  if (state.active) return state.active;
  const env = (import.meta.env.VITE_MINT_CONTRACT as string | undefined)?.trim();
  return env || null;
}

/** Chain the active mint contract lives on (env/legacy contracts → Base). */
export function activeMintChainId(): number {
  const addr = activeMintContract()?.toLowerCase();
  if (!addr) return BASE.id;
  const row = state.deployed.find((d) => d.address.toLowerCase() === addr);
  return row?.chainId ?? BASE.id;
}

// ── per-item editions (mint limit per sealed metadata) ───────────────────────
/** Set how many times one sealed item may be minted. null/0 clears back to the
 *  drop default (drop.editionsPerItem). */
export function setItemEditions(metadataId: string, n: number | null) {
  const editionsByMeta = { ...state.editionsByMeta };
  if (n == null || !Number.isFinite(n) || n < 1) delete editionsByMeta[metadataId];
  else editionsByMeta[metadataId] = Math.floor(n);
  state = { ...state, editionsByMeta };
  persist();
  emit();
}

/** Effective mint limit for an item: its override, else the drop default (≥1). */
export function itemEditionLimit(metadataId: string | undefined | null): number {
  const set = metadataId ? state.editionsByMeta[metadataId] : undefined;
  if (set != null && set >= 1) return Math.floor(set);
  return Math.max(1, Math.floor(state.drop.editionsPerItem || 1));
}

// ── rarity auto-distribution ─────────────────────────────────────────────────
/**
 * Distribute tiers across the batch by the configured percentages —
 * deterministic (item order), remainders go to the first (most common) tier.
 */
export function autoAssignTiers() {
  const n = state.batch.length;
  if (n === 0) return;
  const tiers = state.drop.tiers.filter((t) => t.pct > 0);
  const total = tiers.reduce((s, t) => s + t.pct, 0) || 1;
  const counts = tiers.map((t) => Math.floor((t.pct / total) * n));
  let assigned = counts.reduce((s, c) => s + c, 0);
  while (assigned < n) {
    counts[0] = (counts[0] ?? 0) + 1; // remainder → most common tier
    assigned++;
  }
  // rarest tiers go to the LAST items of the list (stable, previsible), then
  // the owner can override per item in manual mode.
  const seq: string[] = [];
  tiers.forEach((t, i) => {
    for (let k = 0; k < (counts[i] ?? 0); k++) seq.push(t.name);
  });
  state = {
    ...state,
    batch: state.batch.map((b, i) => ({ ...b, tier: seq[i] ?? tiers[0]?.name })),
  };
  emit();
}
