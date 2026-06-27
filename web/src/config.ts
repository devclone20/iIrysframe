// Shared constants for iIrys Frame.

export const APP_NAME = "iIrys Frame";
export const FREE_THRESHOLD = 100 * 1024; // 100 KiB free on Irys

export const GATEWAY = "https://gateway.irys.xyz";
export const GRAPHQL = "https://arweave.mainnet.irys.xyz/graphql";

export const BASE = {
  id: 8453,
  hex: "0x2105",
  name: "Base",
  rpc: "https://mainnet.base.org",
  explorer: "https://basescan.org",
  symbol: "ETH",
} as const;

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
