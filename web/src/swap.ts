import { ethers } from "ethers";
import type { Eip1193Provider } from "./config";

// Same-chain swaps on Base via the LI.FI aggregator (keyless API, routes to the
// cheapest DEX → lowest fees; we take no integrator fee by default).
export const LIFI_API = "https://li.quest/v1";
export const BASE_CHAIN_ID = 8453;
export const NATIVE = "0x0000000000000000000000000000000000000000";

// Set a small integrator fee (e.g. 0.002 = 0.2%) to monetise swaps. Requires a
// fee wallet configured in the LI.FI dashboard for `integrator`. 0 = free.
export const SWAP_FEE = 0; // "cobra bem baixo" → default 0 (cheapest for users)
export const INTEGRATOR = "iIrysFrame";

export interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

// Curated, high-confidence Base tokens. Add more (VIRTUAL, iCLONE…) via the
// "custom address" field — decimals are read on-chain.
export const BASE_TOKENS: Token[] = [
  { symbol: "ETH", name: "Ether", address: NATIVE, decimals: 18 },
  { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  { symbol: "DAI", name: "Dai", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
];

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export function isNative(addr: string): boolean {
  return addr.toLowerCase() === NATIVE || addr.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
}

export interface Quote {
  raw: any;
  toAmount: string; // formatted in toToken decimals
  toAmountWei: string;
  gasUsd: string | null;
  feeUsd: string | null;
  fromUsd: string | null;
  toUsd: string | null;
  approvalAddress: string | null;
  tool: string;
}

export async function getQuote(params: {
  from: Token;
  to: Token;
  amount: string; // human units of `from`
  fromAddress: string;
  slippage?: number;
}): Promise<Quote> {
  const fromAmount = ethers.parseUnits(params.amount, params.from.decimals).toString();
  const url = new URL(`${LIFI_API}/quote`);
  url.searchParams.set("fromChain", String(BASE_CHAIN_ID));
  url.searchParams.set("toChain", String(BASE_CHAIN_ID));
  url.searchParams.set("fromToken", params.from.address);
  url.searchParams.set("toToken", params.to.address);
  url.searchParams.set("fromAmount", fromAmount);
  url.searchParams.set("fromAddress", params.fromAddress);
  url.searchParams.set("integrator", INTEGRATOR);
  url.searchParams.set("slippage", String(params.slippage ?? 0.005));
  if (SWAP_FEE > 0) url.searchParams.set("fee", String(SWAP_FEE));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let msg = text;
    try {
      msg = JSON.parse(text).message ?? text;
    } catch {
      /* keep text */
    }
    throw new Error(msg.slice(0, 160));
  }
  const q = await res.json();
  const est = q.estimate ?? {};
  const sum = (arr: any[]) => arr?.reduce((s, x) => s + Number(x.amountUSD ?? 0), 0) || null;
  return {
    raw: q,
    toAmountWei: est.toAmount,
    toAmount: ethers.formatUnits(est.toAmount ?? "0", params.to.decimals),
    gasUsd: sum(est.gasCosts) != null ? sum(est.gasCosts)!.toFixed(2) : null,
    feeUsd: sum(est.feeCosts) != null ? sum(est.feeCosts)!.toFixed(2) : null,
    fromUsd: est.fromAmountUSD ?? null,
    toUsd: est.toAmountUSD ?? null,
    approvalAddress: est.approvalAddress ?? null,
    tool: q.toolDetails?.name ?? q.tool ?? "DEX",
  };
}

/** Execute a quote: approve ERC-20 if needed, then send the swap tx. */
export async function executeSwap(
  provider: Eip1193Provider,
  quote: Quote,
  onStep?: (s: string) => void,
): Promise<string> {
  const bp = new ethers.BrowserProvider(provider as any);
  const signer = await bp.getSigner();
  const owner = await signer.getAddress();
  const action = quote.raw.action;
  const fromAddr: string = action.fromToken.address;
  const amount = BigInt(action.fromAmount);

  if (!isNative(fromAddr) && quote.approvalAddress) {
    const erc20: any = new ethers.Contract(fromAddr, ERC20_ABI, signer);
    const allowance: bigint = await erc20.allowance(owner, quote.approvalAddress);
    if (allowance < amount) {
      onStep?.("Approving token…");
      const tx = await erc20.approve(quote.approvalAddress, amount);
      await tx.wait();
    }
  }

  onStep?.("Confirm the swap in your wallet…");
  const tr = quote.raw.transactionRequest;
  const tx = await signer.sendTransaction({
    to: tr.to,
    data: tr.data,
    value: tr.value ? BigInt(tr.value) : 0n,
    ...(tr.gasLimit ? { gasLimit: BigInt(tr.gasLimit) } : {}),
  });
  onStep?.("Swapping…");
  await tx.wait();
  return tx.hash;
}

/** Resolve a custom ERC-20 by address (symbol + decimals) on Base. */
export async function resolveToken(provider: Eip1193Provider, address: string): Promise<Token> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Invalid token address.");
  const bp = new ethers.BrowserProvider(provider as any);
  const erc20: any = new ethers.Contract(address, ERC20_ABI, bp);
  const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()]);
  return { symbol, name: symbol, address, decimals: Number(decimals) };
}
