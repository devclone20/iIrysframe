import { ethers } from "ethers";
import { FREE_THRESHOLD, GATEWAY, type Tag, type Eip1193Provider } from "./config";

// The Irys browser SDK is dynamically imported so its Node-shimmed internals
// only load when the user actually connects — keeps first paint clean.
export async function makeUploader(provider: Eip1193Provider): Promise<any> {
  const [{ WebUploader }, { WebBaseEth }, { EthersV6Adapter }] = await Promise.all([
    import("@irys/web-upload"),
    import("@irys/web-upload-ethereum"),
    import("@irys/web-upload-ethereum-ethers-v6"),
  ]);
  const browserProvider = new ethers.BrowserProvider(provider as any);
  // Casts bypass a duplicated @irys/upload-core type the SDK ships nested
  // across its web packages (runtime is correct — same fix as the v1 server).
  const irys = await WebUploader(WebBaseEth as any).withAdapter(EthersV6Adapter(browserProvider) as any);
  return irys;
}

function atomicStr(v: any): string {
  try {
    return v?.toString?.() ?? String(v);
  } catch {
    return String(v);
  }
}

function toBuffer(data: Uint8Array): any {
  const B = (globalThis as any).Buffer;
  return B ? B.from(data) : data;
}

export interface PriceQuote {
  bytes: number;
  free: boolean;
  atomic: string;
  eth: string;
}

export async function priceOf(irys: any, bytes: number): Promise<PriceQuote> {
  const safe = Math.max(0, Math.floor(bytes));
  const atomic = await irys.getPrice(safe);
  return {
    bytes: safe,
    free: safe < FREE_THRESHOLD,
    atomic: atomicStr(atomic),
    eth: atomicStr(irys.utils.fromAtomic(atomic)),
  };
}

export async function nodeBalance(irys: any): Promise<string> {
  const b = await irys.getBalance();
  return atomicStr(irys.utils.fromAtomic(b));
}

export async function nodeBalanceAtomic(irys: any): Promise<bigint> {
  const b = await irys.getBalance();
  return BigInt(atomicStr(b));
}

/**
 * Fund the Irys node from the connected Base wallet.
 *
 * Critically, we sign with the **live** EIP-1193 provider passed in (the same
 * one the Swap uses via `wallet.getProvider()`), NOT the provider captured when
 * the uploader was built — over WalletConnect (Trust Wallet) that cached session
 * goes stale ("Proposal expired") and the request never reaches the wallet.
 *
 * We also bypass the SDK's own `irys.fund()`: its Ethereum token pre-builds a
 * legacy-style tx (manual gas, ethers v5 internals) that injected/WC wallets
 * reject before prompting. Instead we do a plain native transfer to the bundler
 * deposit address with ethers' `signer.sendTransaction` — the exact path the
 * Swap uses successfully — then register the tx so the node credits the balance.
 *
 * No Irys "account" needs creating first: funding your wallet address IS what
 * opens/credits it on the bundler.
 */
export async function fund(irys: any, eth: number, provider: Eip1193Provider): Promise<{ txId: string; balance: string }> {
  if (!provider?.request) throw new Error("Wallet provider unavailable — reconnect the wallet and try again.");

  const amountBN = irys.utils.toAtomic(eth);
  const wei = BigInt(typeof amountBN?.toFixed === "function" ? amountBN.toFixed(0) : atomicStr(amountBN));
  if (wei <= 0n) throw new Error("Funding amount must be greater than zero.");

  // Resolve the deposit address from the SAME node the uploads go to, so the
  // node will credit it. (CORS-enabled; safe to call from the browser.)
  const token: string = irys.token ?? irys.tokenConfig?.name;
  const to: string = await irys.utils.getBundlerAddress(token);
  if (!to) throw new Error("Could not resolve the Irys deposit address — try again in a moment.");

  const bp = new ethers.BrowserProvider(provider as any);
  const signer = await bp.getSigner();
  const tx = await signer.sendTransaction({ to, value: wei });
  await tx.wait();

  // Register the deposit so the node tracks it and credits the balance after its
  // own on-chain confirmation. `submitFundTransaction` retries internally.
  if (typeof irys.funder?.submitFundTransaction === "function") {
    await irys.funder.submitFundTransaction(tx.hash);
  } else {
    await irys.api.post(`/account/balance/${token}`, { tx_id: tx.hash });
  }
  return { txId: tx.hash, balance: await nodeBalance(irys) };
}

/** Withdraw all unused Irys credit back to the connected wallet on Base. */
export async function withdrawAll(irys: any): Promise<{ balance: string }> {
  const bal = await irys.getBalance();
  if (BigInt(atomicStr(bal)) <= 0n) throw new Error("No Irys credit to withdraw.");
  if (typeof irys.withdrawBalance === "function") {
    await irys.withdrawBalance(bal);
  } else if (typeof irys.withdrawAll === "function") {
    await irys.withdrawAll();
  } else {
    throw new Error("Withdraw unsupported in this SDK build — use the CLI: irys withdraw <amount> -t base-eth -w <key>");
  }
  return { balance: await nodeBalance(irys) };
}

/** Ensure node balance covers `atomicNeeded`; fund the shortfall if not. */
export async function ensureFunded(irys: any, atomicNeeded: bigint, provider: Eip1193Provider): Promise<void> {
  if (atomicNeeded <= 0n) return;
  const have = await nodeBalanceAtomic(irys);
  if (have >= atomicNeeded) return;
  const shortfall = atomicNeeded - have;
  const eth = Number(atomicStr(irys.utils.fromAtomic(shortfall.toString())));
  // small buffer so rounding never under-funds
  await fund(irys, Math.max(eth * 1.02, eth + 1e-9), provider);
}

export interface UploadOut {
  id: string;
  url: string;
  mutableUrl: string;
  size: number;
}

export async function uploadData(
  irys: any,
  data: Uint8Array,
  contentType: string,
  tags: Tag[],
): Promise<UploadOut> {
  const allTags: Tag[] = [{ name: "Content-Type", value: contentType }, ...tags];
  const receipt = await irys.upload(toBuffer(data), { tags: allTags });
  return {
    id: receipt.id,
    url: `${GATEWAY}/${receipt.id}`,
    mutableUrl: `${GATEWAY}/mutable/${receipt.id}`,
    size: data.length,
  };
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
