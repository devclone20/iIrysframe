import { ethers } from "ethers";
import { BASE, chainInfo, type Eip1193Provider } from "./config";
import { activeMintChainId, activeMintContract } from "./forge/forgeStore";

/**
 * Mints against the ACTIVE contract: a CloneForge deployed from the ENGINE tab
 * (selected there), falling back to VITE_MINT_CONTRACT (the ICloneAgent).
 * Both share the same mint(address,string) signature.
 */
export const MINT_CONFIG = {
  abi: ["function mint(address to, string uri) payable returns (uint256)"],
  fn: "mint",
};

export function mintContract(): string {
  return activeMintContract() ?? "";
}

export function canMint(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(mintContract());
}

/** Fee overrides for the target chain. Robinhood Chain (Nitro) runs EIP-1559
 *  with a ZERO tip market — ethers' default 1-gwei priority fee would overpay
 *  ~20× on its ~0.045-gwei baseFee, so pin the tip to 0 and cap maxFee at
 *  2× baseFee. Base keeps ethers' defaults. Gas LIMIT is never hardcoded:
 *  estimateGas already folds Nitro's L1 posting cost into the estimate. */
export async function feeOverridesFor(
  bp: ethers.BrowserProvider,
  chainId: number,
): Promise<{ maxPriorityFeePerGas?: bigint; maxFeePerGas?: bigint }> {
  if (chainId === BASE.id) return {};
  const block = await bp.getBlock("latest");
  const base = block?.baseFeePerGas ?? null;
  if (base == null) return {};
  return { maxPriorityFeePerGas: 0n, maxFeePerGas: base * 2n };
}

export async function mint(
  provider: Eip1193Provider,
  to: string,
  tokenURI: string,
  chainId: number = activeMintChainId(),
): Promise<string> {
  if (!canMint()) throw new Error("No mint contract — deploy one in ENGINE or set VITE_MINT_CONTRACT.");
  const chain = chainInfo(chainId);
  const bp = new ethers.BrowserProvider(provider as any);
  const net = await bp.getNetwork();
  if (Number(net.chainId) !== chain.id) throw new Error(`Switch the wallet to ${chain.name} first`);
  const signer = await bp.getSigner();
  const contract = new ethers.Contract(mintContract(), MINT_CONFIG.abi, signer);
  const overrides = await feeOverridesFor(bp, chain.id);
  const tx = await (contract as any)[MINT_CONFIG.fn](to, tokenURI, overrides);
  return tx.hash as string;
}
