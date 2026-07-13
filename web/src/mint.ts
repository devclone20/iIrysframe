import { ethers } from "ethers";
import { BASE, type Eip1193Provider } from "./config";
import { activeMintContract } from "./forge/forgeStore";

/**
 * Mints against the ACTIVE contract: a CloneForge deployed from the ENGINE tab
 * (selected there), falling back to VITE_MINT_CONTRACT (the ICloneAgent).
 * Both share the same mint(address,string) signature.
 */
export const MINT_CONFIG = {
  chainHex: BASE.hex,
  abi: ["function mint(address to, string uri) payable returns (uint256)"],
  fn: "mint",
};

export function mintContract(): string {
  return activeMintContract() ?? "";
}

export function canMint(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(mintContract());
}

export async function mint(
  provider: Eip1193Provider,
  to: string,
  tokenURI: string,
): Promise<string> {
  if (!canMint()) throw new Error("No mint contract — deploy one in ENGINE or set VITE_MINT_CONTRACT.");
  const bp = new ethers.BrowserProvider(provider as any);
  const signer = await bp.getSigner();
  const contract = new ethers.Contract(mintContract(), MINT_CONFIG.abi, signer);
  const tx = await (contract as any)[MINT_CONFIG.fn](to, tokenURI);
  return tx.hash as string;
}
