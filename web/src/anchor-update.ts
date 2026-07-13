// Single-purpose page: refine the ATLAS soul on its mutable Irys anchor,
// signed by MetaMask — the private key never leaves the wallet.
//
// Reuses the same makeUploader/uploadData that sealed v1. The wallet is the raw
// injected provider (window.ethereum); no Privy. Guards the signer address so
// the update can only come from the wallet that owns the root tx.

import { makeUploader, uploadData } from "./irys";
import { GATEWAY, FREE_THRESHOLD, type Tag } from "./config";

const ROOT_TX = "JCTu7dmsEa327ymLZXpXvvPDv3vi3Vu69kaVddDCoiMZ";
const OWNER = "0xb94bba9d50a8b4b7473cb2687f5f633a54710fad";
const METADATA_URL = "/atlas1.metadata.v2.json";

const TAGS: Tag[] = [
  { name: "Root-TX", value: ROOT_TX },
  { name: "App-Name", value: "iIrys Frame" },
  { name: "Item", value: "34b57dd7-6bc8-4163-b489-63e14c97447f" },
  { name: "Name", value: "ATLAS #1 — metadata" },
  { name: "Type", value: "metadata" },
  { name: "Edition", value: "1" },
  { name: "Collection", value: "ATLAS CORPORATION" },
  { name: "Tier", value: "iclone" },
];

const $ = (id: string) => document.getElementById(id)!;
const log = (msg: string, cls = "") => {
  const el = $("log");
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
};

let connectedAddr: string | null = null;
let metaBytes: Uint8Array | null = null;

function eth(): any {
  const e = (window as any).ethereum;
  if (!e) throw new Error("No injected wallet found. Install/enable MetaMask, then reload.");
  return e;
}

async function loadMetadata() {
  const res = await fetch(METADATA_URL);
  if (!res.ok) throw new Error(`could not load ${METADATA_URL} (${res.status})`);
  const text = await res.text();
  const json = JSON.parse(text); // validate it parses
  metaBytes = new TextEncoder().encode(text);
  $("meta").textContent =
    `name: ${json.name}\n` +
    `personality: ${json.ai_soul?.personality}\n` +
    `soul: ${(json.ai_soul?.system_prompt || "").includes("Harness Architect") ? "v2 · Harness Architect ✓" : "⚠ not the v2 soul"}\n` +
    `bytes: ${metaBytes.length} (${metaBytes.length < FREE_THRESHOLD ? "free — under 100 KiB" : "OVER 100 KiB"})`;
}

async function connect() {
  try {
    const accounts: string[] = await eth().request({ method: "eth_requestAccounts" });
    connectedAddr = (accounts[0] || "").toLowerCase();
    const ok = connectedAddr === OWNER;
    $("addr").textContent = connectedAddr || "(none)";
    $("addr").className = ok ? "ok" : "bad";
    if (ok) {
      log("Wallet connected — matches the root owner. Ready to sign.", "ok");
      ($("upload") as HTMLButtonElement).disabled = false;
    } else {
      log(`Connected wallet ${connectedAddr} is NOT the root owner ${OWNER}.`, "bad");
      log("Switch MetaMask to the account that sealed ATLAS #1, then reconnect.", "bad");
      ($("upload") as HTMLButtonElement).disabled = true;
    }
  } catch (e: any) {
    log("connect failed: " + (e?.message || e), "bad");
  }
}

async function upload() {
  const btn = $("upload") as HTMLButtonElement;
  btn.disabled = true;
  try {
    if (connectedAddr !== OWNER) throw new Error("wrong wallet — refusing");
    if (!metaBytes) throw new Error("metadata not loaded");

    log("Building the Irys uploader (browser + MetaMask)…");
    const irys = await makeUploader(eth());

    // Belt-and-suspenders: the uploader must resolve to the same owner address.
    if (irys.address && irys.address.toLowerCase() !== OWNER) {
      throw new Error(`uploader address ${irys.address} != root owner — aborting`);
    }

    log("Requesting your signature in MetaMask… (approve the pop-up)");
    const out = await uploadData(irys, metaBytes, "application/json", TAGS);

    log("UPLOAD OK ✓", "ok");
    log("new tx: " + out.id, "ok");
    const link = `${GATEWAY}/mutable/${ROOT_TX}`;
    $("result").innerHTML =
      `<div class="ok">Anchor refined to v2.</div>` +
      `<div>new tx: <code>${out.id}</code></div>` +
      `<div>mutable anchor (what the NFT reads): <a href="${link}" target="_blank">${link}</a></div>` +
      `<div class="hint">It resolves to the new tx within a few seconds. The immutable root ` +
      `<code>${GATEWAY}/${ROOT_TX}</code> keeps serving v1 forever.</div>`;
  } catch (e: any) {
    log("upload failed: " + (e?.message || e), "bad");
    btn.disabled = connectedAddr !== OWNER;
  }
}

// wire up
$("connect").addEventListener("click", connect);
$("upload").addEventListener("click", upload);
loadMetadata().then(
  () => log("Metadata loaded. Connect MetaMask to continue."),
  (e) => log("metadata load failed: " + (e?.message || e), "bad"),
);
