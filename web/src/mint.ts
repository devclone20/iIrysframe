import { ethers } from "ethers";
import { BASE, type Eip1193Provider } from "./config";

/**
 * Dormant minting. The metadata tokenURI is produced today; flip this on by
 * setting CONTRACT to your deployed Base ERC-721 address (and adjusting the
 * ABI/function if your mint signature differs). Until then `canMint()` is false
 * and the UI only offers the copy-able mint link.
 */
export const MINT_CONFIG = {
  contract: (import.meta.env.VITE_MINT_CONTRACT ?? "").trim() as string, // your Base ERC-721

  chainHex: BASE.hex,
  // Matches contracts/src/ICloneAgent.sol: mint(address,string) payable → tokenId
  abi: ["function mint(address to, string uri) payable returns (uint256)"],
  fn: "mint",
};

export function canMint(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(MINT_CONFIG.contract);
}

export async function mint(
  provider: Eip1193Provider,
  to: string,
  tokenURI: string,
): Promise<string> {
  if (!canMint()) throw new Error("No mint contract configured (set MINT_CONFIG.contract).");
  const bp = new ethers.BrowserProvider(provider as any);
  const signer = await bp.getSigner();
  const contract = new ethers.Contract(MINT_CONFIG.contract, MINT_CONFIG.abi, signer);
  const tx = await (contract as any)[MINT_CONFIG.fn](to, tokenURI);
  return tx.hash as string;
}
