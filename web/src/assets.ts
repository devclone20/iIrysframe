// Multi-chain wallet assets — the balances list shown in the wallet panel.
//
// Seven assets ship on by default; five more can be toggled from the "+"
// manager (a deliberately short list — the owner capped it). All reads go to
// public keyless RPCs via plain JSON-RPC fetch, never through the wallet's
// EIP-1193 provider: that keeps the list independent of the active chain and
// never prompts the user. Every endpoint has a fallback and a hard timeout so
// one slow chain can never stall the panel.

export interface AssetDef {
  id: string;
  symbol: string;
  chain: string; // display name of the network
  kind: "native" | "erc20" | "solana";
  rpcs: string[]; // primary + fallback (all CORS-open, keyless)
  token?: string; // erc20 contract
  decimals: number;
  /** coingecko id for the ≈$ figure; "" = no price shown */
  price: string;
  optional?: boolean; // lives behind the "+" manager
}

export const ASSETS: AssetDef[] = [
  // ── the seven defaults (owner's order) ─────────────────────────────────────
  { id: "eth-robinhood", symbol: "ETH", chain: "Robinhood Chain", kind: "native", decimals: 18, price: "ethereum",
    rpcs: ["https://rpc.mainnet.chain.robinhood.com"] },
  { id: "virtual-base", symbol: "VIRTUAL", chain: "Base", kind: "erc20", decimals: 18, price: "virtual-protocol",
    token: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"] },
  { id: "eth-base", symbol: "ETH", chain: "Base", kind: "native", decimals: 18, price: "ethereum",
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"] },
  { id: "bnb", symbol: "BNB", chain: "BNB Chain", kind: "native", decimals: 18, price: "binancecoin",
    rpcs: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"] },
  { id: "sol", symbol: "SOL", chain: "Solana", kind: "solana", decimals: 9, price: "solana",
    rpcs: ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"] },
  { id: "eth-mainnet", symbol: "ETH", chain: "Ethereum", kind: "native", decimals: 18, price: "ethereum",
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"] },
  { id: "usdc-base", symbol: "USDC", chain: "Base", kind: "erc20", decimals: 6, price: "usd-coin",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"] },
  // ── the five optionals ─────────────────────────────────────────────────────
  { id: "pol", symbol: "POL", chain: "Polygon", kind: "native", decimals: 18, price: "polygon-ecosystem-token", optional: true,
    rpcs: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"] },
  { id: "eth-arbitrum", symbol: "ETH", chain: "Arbitrum One", kind: "native", decimals: 18, price: "ethereum", optional: true,
    rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"] },
  { id: "eth-optimism", symbol: "ETH", chain: "OP Mainnet", kind: "native", decimals: 18, price: "ethereum", optional: true,
    rpcs: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"] },
  { id: "avax", symbol: "AVAX", chain: "Avalanche", kind: "native", decimals: 18, price: "avalanche-2", optional: true,
    rpcs: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"] },
  { id: "usdc-eth", symbol: "USDC", chain: "Ethereum", kind: "erc20", decimals: 6, price: "usd-coin", optional: true,
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"] },
];

export interface AssetBalance {
  def: AssetDef;
  /** formatted balance, "—" when unavailable (no address / all RPCs failed) */
  display: string;
  raw: bigint | null;
  usd: number | null;
}

const PREFS_KEY = "iirys.wallet.assets.v1";

/** Ids of the optional assets the user switched on (defaults are always on). */
export function loadAssetPrefs(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "[]");
    if (Array.isArray(raw)) return new Set(raw.filter((x) => typeof x === "string"));
  } catch { /* fresh start */ }
  return new Set();
}

export function saveAssetPrefs(on: Set<string>): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify([...on]));
}

export function visibleAssets(prefs: Set<string>): AssetDef[] {
  return ASSETS.filter((a) => !a.optional || prefs.has(a.id));
}

// ── plumbing ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 6000;

async function rpcPost(url: string, body: unknown): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || "rpc error");
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

async function firstRpc(urls: string[], body: unknown): Promise<any> {
  let last: unknown;
  for (const u of urls) {
    try { return await rpcPost(u, body); } catch (e) { last = e; }
  }
  throw last;
}

async function fetchOne(def: AssetDef, evm: string, sol?: string): Promise<bigint | null> {
  if (def.kind === "solana") {
    if (!sol) return null;
    const r = await firstRpc(def.rpcs, { jsonrpc: "2.0", id: 1, method: "getBalance", params: [sol] });
    return BigInt(r?.value ?? 0);
  }
  if (def.kind === "erc20") {
    const data = "0x70a08231" + evm.slice(2).toLowerCase().padStart(64, "0");
    const r = await firstRpc(def.rpcs, {
      jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to: def.token, data }, "latest"],
    });
    return BigInt(r === "0x" ? 0 : r);
  }
  const r = await firstRpc(def.rpcs, {
    jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [evm, "latest"],
  });
  return BigInt(r);
}

function fmtUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).slice(0, 5).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? "." + frac : ""}`;
}

// ── spot prices (CoinGecko keyless, one call for every id, 60s cache) ────────

let priceCache: { at: number; map: Record<string, number> } = { at: 0, map: {} };

async function spotPrices(ids: string[]): Promise<Record<string, number>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  if (Date.now() - priceCache.at < 60_000 && uniq.every((i) => i in priceCache.map)) return priceCache.map;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${uniq.join(",")}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const j = await res.json();
    const map: Record<string, number> = { ...priceCache.map };
    for (const id of uniq) map[id] = j?.[id]?.usd ?? map[id] ?? 0;
    priceCache = { at: Date.now(), map };
  } catch { /* keep stale prices — better than none */ }
  return priceCache.map;
}

// ── the one entry point ──────────────────────────────────────────────────────

const balCache = new Map<string, { at: number; raw: bigint | null }>();
const BAL_TTL = 30_000;

/**
 * Fetch every visible asset's balance in parallel. Individual failures render
 * as "—" — the list never throws and never blocks on one slow chain.
 */
export async function fetchAssetBalances(
  evmAddress: string,
  opts: { solAddress?: string; prefs?: Set<string>; fresh?: boolean } = {},
): Promise<AssetBalance[]> {
  const defs = visibleAssets(opts.prefs ?? loadAssetPrefs());
  const prices = await spotPrices(defs.map((d) => d.price));
  return Promise.all(
    defs.map(async (def): Promise<AssetBalance> => {
      const key = `${def.id}:${evmAddress}:${opts.solAddress ?? ""}`;
      const hit = balCache.get(key);
      let raw: bigint | null;
      if (!opts.fresh && hit && Date.now() - hit.at < BAL_TTL) {
        raw = hit.raw;
      } else {
        try {
          raw = await fetchOne(def, evmAddress, opts.solAddress);
          balCache.set(key, { at: Date.now(), raw });
        } catch {
          raw = hit?.raw ?? null; // stale beats blank; null renders as "—"
        }
      }
      const display = raw == null ? "—" : fmtUnits(raw, def.decimals);
      const spot = prices[def.price] ?? 0;
      const usd = raw == null || !spot ? null : (Number(raw) / 10 ** def.decimals) * spot;
      return { def, display, raw, usd };
    }),
  );
}
