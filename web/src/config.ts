// Shared constants for iIrys Frame.

export const APP_NAME = "iIrys Frame";
export const APP_VERSION = "0.4.0";
export const FREE_THRESHOLD = 100 * 1024; // 100 KiB free on Irys

export const GATEWAY = "https://gateway.irys.xyz";
// uploader.irys.xyz is the live index; the old arweave.mainnet.irys.xyz
// endpoint stopped indexing new uploads (verified 2026-07-02).
export const GRAPHQL = "https://uploader.irys.xyz/graphql";

export const BASE = {
  id: 8453,
  hex: "0x2105",
  name: "Base",
  rpc: "https://mainnet.base.org",
  explorer: "https://basescan.org",
  symbol: "ETH",
} as const;

// Robinhood Chain — Arbitrum Nitro L2, gas in ETH. The app layer is
// permissionless (anyone can deploy); there is no first-party CLI and the
// public RPC serves browsers directly (CORS *). Nitro quirk that matters for
// txs: the fee market is EIP-1559 with a ZERO tip — ethers' default 1-gwei
// priority fee would overpay ~20×, so senders pass explicit fee overrides.
export const ROBINHOOD = {
  id: 4663,
  hex: "0x1237",
  name: "Robinhood Chain",
  rpc: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  symbol: "ETH",
} as const;

export interface ChainInfo {
  id: number;
  hex: string;
  name: string;
  rpc: string;
  explorer: string;
  symbol: string;
}

/** Chains a CloneForge contract can live on. Base stays the default. */
export const DEPLOY_CHAINS: Record<number, ChainInfo> = {
  [BASE.id]: BASE,
  [ROBINHOOD.id]: ROBINHOOD,
};

export function chainInfo(id?: number | null): ChainInfo {
  return DEPLOY_CHAINS[id ?? BASE.id] ?? BASE;
}

export const TIERS = ["rare", "superrare", "iclone"] as const;
export type Tier = (typeof TIERS)[number];

export interface Tag {
  name: string;
  value: string;
}

/** Minimal EIP-1193 provider shape (what Privy/wallets hand us). */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<any>;
  on?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
}
