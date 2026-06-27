import crypto from "node:crypto";
import { Uploader } from "@irys/upload";
import { Ethereum } from "@irys/upload-ethereum";
import { config, NETWORKS, FREE_THRESHOLD_BYTES, baseTags, type NetworkId } from "./config.js";

export interface Tag {
  name: string;
  value: string;
}

// Cache one uploader per (network, mode). Building an uploader does a network
// handshake, so we never want to do it twice for the same context.
const cache = new Map<string, Promise<any>>();

function ephemeralKey(): string {
  return "0x" + crypto.randomBytes(32).toString("hex");
}

/**
 * Build (or reuse) an Irys uploader.
 *  - With a real PRIVATE_KEY: a live, fundable signer.
 *  - Without one, in readOnly mode: an ephemeral throwaway wallet, used only
 *    for price/network reads (price is a property of bytes + network, not the
 *    wallet). Funding / uploading without a key throws.
 */
export async function getUploader(
  network: NetworkId,
  opts: { readOnly?: boolean } = {},
): Promise<any> {
  const readOnly = opts.readOnly ?? false;
  if (!config.privateKey && !readOnly) {
    throw new Error(
      "No PRIVATE_KEY configured. Set it in .env to fund or upload (iIrys Frame is read-only without one).",
    );
  }

  const mode = config.privateKey ? "live" : "eph";
  const key = `${network}:${mode}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = build(network);
    cache.set(key, pending);
  }
  try {
    return await pending;
  } catch (err) {
    cache.delete(key); // allow retry on transient handshake failure
    throw err;
  }
}

async function build(network: NetworkId): Promise<any> {
  const net = NETWORKS[network];
  const signerKey = config.privateKey ?? ephemeralKey();

  // `Ethereum` is cast to bypass a duplicated @irys/upload-core type that the
  // SDK ships nested under upload-ethereum (runtime is correct).
  let builder: any = Uploader(Ethereum as any).withWallet(signerKey);
  // Devnet *requires* a Sepolia RPC; mainnet uses an Ethereum L1 RPC.
  builder = builder.withRpc(config.rpcFor(network));
  if (net.devnet) builder = builder.devnet();

  return builder; // builder is thenable — awaiting resolves the uploader
}

function atomic(v: any): string {
  try {
    return v?.toString?.() ?? String(v);
  } catch {
    return String(v);
  }
}

export interface VaultStatus {
  connected: boolean;
  readOnly: boolean;
  network: NetworkConfigView;
  address: string | null;
  token: string | null;
  balanceAtomic: string | null;
  balance: string | null;
}

interface NetworkConfigView {
  id: NetworkId;
  label: string;
  gateway: string;
  permanent: boolean;
}

function netView(network: NetworkId): NetworkConfigView {
  const n = NETWORKS[network];
  return { id: n.id, label: n.label, gateway: n.gateway, permanent: n.permanent };
}

export async function getStatus(network: NetworkId): Promise<VaultStatus> {
  const base: VaultStatus = {
    connected: false,
    readOnly: !config.hasKey,
    network: netView(network),
    address: null,
    token: null,
    balanceAtomic: null,
    balance: null,
  };
  if (!config.privateKey) return base;

  const irys = await getUploader(network);
  const bal = await irys.getBalance();
  return {
    ...base,
    connected: true,
    readOnly: false,
    address: irys.address ?? null,
    token: irys.token ?? "ethereum",
    balanceAtomic: atomic(bal),
    balance: atomic(irys.utils.fromAtomic(bal)),
  };
}

export interface PriceQuote {
  bytes: number;
  free: boolean;
  priceAtomic: string;
  price: string;
  token: string;
}

export async function getPrice(network: NetworkId, bytes: number): Promise<PriceQuote> {
  const safeBytes = Math.max(0, Math.floor(bytes));
  const irys = await getUploader(network, { readOnly: true });
  const free = safeBytes < FREE_THRESHOLD_BYTES;
  const p = await irys.getPrice(safeBytes);
  return {
    bytes: safeBytes,
    free,
    priceAtomic: atomic(p),
    price: atomic(irys.utils.fromAtomic(p)),
    token: irys.token ?? "ethereum",
  };
}

export interface FundResult {
  requestedEth: number;
  quantityAtomic: string;
  txId: string | null;
  balanceAtomic: string;
  balance: string;
}

export async function fund(network: NetworkId, eth: number): Promise<FundResult> {
  if (!Number.isFinite(eth) || eth <= 0) throw new Error("Fund amount must be a positive number.");
  if (eth > config.fundMaxEth) {
    throw new Error(`Fund amount ${eth} exceeds the FUND_MAX_ETH safety cap (${config.fundMaxEth}).`);
  }
  const irys = await getUploader(network);
  const amount = irys.utils.toAtomic(eth);
  const resp = await irys.fund(amount);
  const bal = await irys.getBalance();
  return {
    requestedEth: eth,
    quantityAtomic: atomic(resp?.quantity ?? amount),
    txId: resp?.id ?? null,
    balanceAtomic: atomic(bal),
    balance: atomic(irys.utils.fromAtomic(bal)),
  };
}

export interface UploadResult {
  id: string;
  url: string;
  mutableUrl: string;
  size: number;
  contentType: string;
  name: string;
  network: NetworkId;
  address: string | null;
  tags: Tag[];
  createdAt: string;
}

async function doUpload(
  network: NetworkId,
  data: Buffer | string,
  contentType: string,
  name: string,
  meta: Record<string, string>,
): Promise<UploadResult> {
  const irys = await getUploader(network);
  const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
  const tags: Tag[] = [
    { name: "Content-Type", value: contentType },
    ...baseTags(network, { Name: name, ...meta }),
  ];
  const receipt = await irys.upload(data, { tags });
  const gateway = NETWORKS[network].gateway;
  return {
    id: receipt.id,
    url: `${gateway}/${receipt.id}`,
    mutableUrl: `${gateway}/mutable/${receipt.id}`,
    size,
    contentType,
    name,
    network,
    address: irys.address ?? null,
    tags,
    createdAt: new Date().toISOString(),
  };
}

export function uploadFile(
  network: NetworkId,
  buffer: Buffer,
  contentType: string,
  name: string,
  meta: Record<string, string> = {},
): Promise<UploadResult> {
  return doUpload(network, buffer, contentType, name, meta);
}

export function uploadJSON(
  network: NetworkId,
  json: unknown,
  name: string,
  meta: Record<string, string> = {},
): Promise<UploadResult> {
  return doUpload(network, JSON.stringify(json, null, 2), "application/json", name, {
    Type: "metadata",
    ...meta,
  });
}
