import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export type NetworkId = "mainnet" | "devnet";

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  gateway: string;
  graphql: string;
  /** true => use the Irys devnet bundler (testnet tokens, ~60-day retention) */
  devnet: boolean;
  /** true => uploads are permanent */
  permanent: boolean;
}

/** Uploads strictly below this size are free on Irys. */
export const FREE_THRESHOLD_BYTES = 100 * 1024; // 100 KiB

const env = process.env;

function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    gateway: (env.MAINNET_GATEWAY ?? "https://gateway.irys.xyz").replace(/\/+$/, ""),
    graphql: env.MAINNET_GRAPHQL ?? "https://arweave.mainnet.irys.xyz/graphql",
    devnet: false,
    permanent: true,
  },
  devnet: {
    id: "devnet",
    label: "Devnet",
    gateway: (env.DEVNET_GATEWAY ?? "https://gateway.irys.xyz").replace(/\/+$/, ""),
    graphql: env.DEVNET_GRAPHQL ?? "https://arweave.devnet.irys.xyz/graphql",
    devnet: true,
    permanent: false,
  },
};

function normalizeNetwork(v: string | undefined): NetworkId {
  return v === "mainnet" ? "mainnet" : "devnet";
}

/**
 * Irys devnet pays in Sepolia ETH and *requires* a testnet RPC; mainnet uses
 * Ethereum L1. These are sane public defaults — override with EVM_RPC_URL.
 */
export const RPC_DEFAULTS: Record<NetworkId, string> = {
  devnet: "https://ethereum-sepolia-rpc.publicnode.com",
  mainnet: "https://ethereum-rpc.publicnode.com",
};

const PRIVATE_KEY = (env.PRIVATE_KEY ?? "").trim();
const VALID_KEY = /^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY);
if (PRIVATE_KEY && !VALID_KEY) {
  // Don't print the key; just warn it's malformed.
  console.warn("[config] PRIVATE_KEY is set but is not a valid 0x + 64 hex string — running read-only.");
}

const dataDir = path.join(ROOT, "data");
fs.mkdirSync(dataDir, { recursive: true });

export const config = {
  root: ROOT,
  dataDir,
  publicDir: path.join(ROOT, "public"),
  manifestPath: path.join(dataDir, "manifest.json"),

  privateKey: VALID_KEY ? PRIVATE_KEY : null,
  hasKey: VALID_KEY,

  defaultNetwork: normalizeNetwork(env.NETWORK),
  evmRpcUrl: (env.EVM_RPC_URL ?? "").trim() || null,
  rpcFor(network: NetworkId): string {
    return (env.EVM_RPC_URL ?? "").trim() || RPC_DEFAULTS[network];
  },

  fundMaxEth: Number.parseFloat(env.FUND_MAX_ETH ?? "0.1") || 0.1,
  vaultToken: (env.VAULT_TOKEN ?? "").trim() || null,

  port: Number.parseInt(env.PORT ?? "1717", 10) || 1717,
  host: env.HOST ?? "127.0.0.1",

  appName: "iIrys Frame",
  appTag: "CLONE-FRAME",
  verbose: bool(env.VERBOSE),
} as const;

/** Tags every iIrys Frame upload carries — used to query the vault back from Irys. */
export function baseTags(network: NetworkId, extra: Record<string, string> = {}) {
  const tags: { name: string; value: string }[] = [
    { name: "App-Name", value: config.appName },
    { name: "App", value: config.appTag },
    { name: "Network", value: network },
  ];
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      tags.push({ name, value: String(value) });
    }
  }
  return tags;
}
