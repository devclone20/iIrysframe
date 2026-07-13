// Deploy + administer CloneForge contracts straight from the app.
// The contract is precompiled with Foundry (contracts/src/CloneForge.sol);
// every knob is a constructor arg, so no in-browser Solidity compiler is
// needed — deploying is one wallet transaction with encoded args.

import { ethers } from "ethers";
import artifact from "./CloneForgeArtifact.json";
import { BASE, type Eip1193Provider } from "../config";
import type { DropConfig } from "./forgeStore";

/** Canonical ERC-6551 registry + the Tokenbound implementation used by ICloneAgent. */
export const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
export const ERC6551_IMPLEMENTATION = "0x41C8f39463A868d3A88af00cd0fe7102F30E44eC";

/** Developer-support fee destination — receives the optional 1–5% fee a creator
 *  chooses to embed in their contract. Defaults to the CLONE FRAME founder wallet;
 *  set to a dedicated dev wallet before shipping paid mints if you prefer. */
export const DEV_WALLET = "0xb4805e8d8c9f23fa4615422202be1e38fba6a739";

const SUPPORT_MODE = { none: 0, first: 1, perpetual: 2 } as const;

export interface ForgeDeployParams {
  name: string;
  symbol: string;
  royaltyReceiver: string;
  contractURI: string; // sealed collection profile (may be "")
  dropBaseURI: string; // sealed drop manifest base (may be "")
  drop: DropConfig;
}

function toConfigStruct(owner: string, p: ForgeDeployParams) {
  const mode = p.drop.devSupportMode ?? "none";
  const devBps = mode === "none" ? 0 : Math.max(100, Math.min(500, Math.round(p.drop.devBps || 0)));
  return {
    name: p.name,
    symbol: p.symbol,
    owner,
    royaltyReceiver: p.royaltyReceiver || owner,
    royaltyBps: BigInt(Math.max(0, Math.min(10_000, Math.round(p.drop.royaltyBps)))),
    maxSupply: BigInt(Math.max(0, Math.floor(p.drop.maxSupply))),
    mintPrice: ethers.parseEther(p.drop.priceEth || "0"),
    publicMint: p.drop.publicMint,
    walletLimit: BigInt(Math.max(0, Math.floor(p.drop.walletLimit))),
    ogCard: p.drop.ogGated && ethers.isAddress(p.drop.ogAddress) ? p.drop.ogAddress : ethers.ZeroAddress,
    contractURI_: p.contractURI,
    dropBaseURI: p.dropBaseURI,
    erc6551Registry: ERC6551_REGISTRY,
    erc6551Implementation: ERC6551_IMPLEMENTATION,
    developer: mode === "none" ? ethers.ZeroAddress : DEV_WALLET,
    devBps: BigInt(devBps),
    supportMode: SUPPORT_MODE[mode],
  };
}

export interface DeployOut {
  address: string;
  txHash: string;
}

export async function deployCloneForge(provider: Eip1193Provider, params: ForgeDeployParams): Promise<DeployOut> {
  const bp = new ethers.BrowserProvider(provider as any);
  const net = await bp.getNetwork();
  if (Number(net.chainId) !== BASE.id) throw new Error("Switch the wallet to Base first");
  const signer = await bp.getSigner();
  const owner = await signer.getAddress();

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(toConfigStruct(owner, params));
  const tx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  return { address: await contract.getAddress(), txHash: tx?.hash ?? "" };
}

/** Gas estimate in ETH for the deploy (so the user sees the cost up front). */
export async function estimateDeployEth(provider: Eip1193Provider, params: ForgeDeployParams): Promise<string> {
  const bp = new ethers.BrowserProvider(provider as any);
  const signer = await bp.getSigner();
  const owner = await signer.getAddress();
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const txReq = await factory.getDeployTransaction(toConfigStruct(owner, params));
  const [gas, fee] = await Promise.all([bp.estimateGas({ ...txReq, from: owner }), bp.getFeeData()]);
  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  return ethers.formatEther(gas * price);
}

// ── live contract state + admin (works for CloneForge; reads that ICloneAgent
//    also exposes — maxSupply/mintPrice/publicMint/totalMinted — degrade softly) ──
const READ_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalMinted() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function mintPrice() view returns (uint256)",
  "function publicMint() view returns (bool)",
  "function walletLimit() view returns (uint256)",
  "function ogCard() view returns (address)",
  "function dropBaseURI() view returns (string)",
  "function contractURI() view returns (string)",
  "function owner() view returns (address)",
  "function supportMode() view returns (uint8)",
  "function developer() view returns (address)",
  "function devBps() view returns (uint96)",
  "function devAccrued() view returns (uint256)",
  "function royaltySplit() view returns (address)",
];

const ADMIN_ABI = [
  "function setPublicMint(bool enabled)",
  "function setMintPrice(uint256 price)",
  "function setMaxSupply(uint256 supply)",
  "function setWalletLimit(uint256 limit)",
  "function setOgCard(address card)",
  "function setDropBaseURI(string uri)",
  "function setContractURI(string uri)",
  "function withdraw(address to)",
  "function withdrawDev()",
];

export interface ContractState {
  name: string;
  symbol: string;
  totalMinted: bigint | null;
  maxSupply: bigint | null;
  mintPriceEth: string | null;
  publicMint: boolean | null;
  walletLimit: bigint | null;
  ogCard: string | null;
  dropBaseURI: string | null;
  contractURI: string | null;
  owner: string | null;
  supportMode: number | null; // 0 None · 1 FirstSale · 2 Perpetual
  developer: string | null;
  devBps: bigint | null;
  devAccruedEth: string | null; // pull-able first-sale dev cut
  royaltySplit: string | null;
}

export async function readContractState(address: string): Promise<ContractState> {
  const rpc = new ethers.JsonRpcProvider(BASE.rpc);
  const c = new ethers.Contract(address, READ_ABI, rpc);
  const grab = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch {
      return null; // older contracts (ICloneAgent) miss some views
    }
  };
  const [name, symbol] = await Promise.all([grab(() => c.name!()), grab(() => c.symbol!())]);
  const [totalMinted, maxSupply, price, publicMint, walletLimit, ogCard, dropBaseURI, contractURI, owner] =
    await Promise.all([
      grab(() => c.totalMinted!()),
      grab(() => c.maxSupply!()),
      grab(() => c.mintPrice!()),
      grab(() => c.publicMint!()),
      grab(() => c.walletLimit!()),
      grab(() => c.ogCard!()),
      grab(() => c.dropBaseURI!()),
      grab(() => c.contractURI!()),
      grab(() => c.owner!()),
    ]);
  const [supportMode, developer, devBps, devAccrued, royaltySplit] = await Promise.all([
    grab(() => c.supportMode!()),
    grab(() => c.developer!()),
    grab(() => c.devBps!()),
    grab(() => c.devAccrued!()),
    grab(() => c.royaltySplit!()),
  ]);
  return {
    name: (name as string) ?? "?",
    symbol: (symbol as string) ?? "?",
    totalMinted: totalMinted as bigint | null,
    maxSupply: maxSupply as bigint | null,
    mintPriceEth: price != null ? ethers.formatEther(price as bigint) : null,
    publicMint: publicMint as boolean | null,
    walletLimit: walletLimit as bigint | null,
    ogCard: ogCard as string | null,
    dropBaseURI: dropBaseURI as string | null,
    contractURI: contractURI as string | null,
    owner: owner as string | null,
    supportMode: supportMode != null ? Number(supportMode) : null,
    developer: developer as string | null,
    devBps: devBps as bigint | null,
    devAccruedEth: devAccrued != null ? ethers.formatEther(devAccrued as bigint) : null,
    royaltySplit: royaltySplit as string | null,
  };
}

export type AdminAction =
  | { fn: "setPublicMint"; args: [boolean] }
  | { fn: "setMintPrice"; args: [bigint] }
  | { fn: "setMaxSupply"; args: [bigint] }
  | { fn: "setWalletLimit"; args: [bigint] }
  | { fn: "setOgCard"; args: [string] }
  | { fn: "setDropBaseURI"; args: [string] }
  | { fn: "setContractURI"; args: [string] }
  | { fn: "withdraw"; args: [string] }
  | { fn: "withdrawDev"; args: [] };

export async function adminCall(provider: Eip1193Provider, address: string, action: AdminAction): Promise<string> {
  const bp = new ethers.BrowserProvider(provider as any);
  const signer = await bp.getSigner();
  const c = new ethers.Contract(address, ADMIN_ABI, signer);
  const tx = await (c as any)[action.fn](...action.args);
  await tx.wait();
  return tx.hash as string;
}

export const parseEthOrZero = (v: string): bigint => {
  try {
    return ethers.parseEther(v || "0");
  } catch {
    return 0n;
  }
};
