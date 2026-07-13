// Turn a minted iNFT into an AI agent. Two independent tracks:
//
//   A. ON-CHAIN BINDS (browser, the user signs via Privy, one tx each):
//      · createTokenAccount — the NFT's ERC-6551 token-bound wallet (its vault)
//      · registerErc8004    — an ERC-8004 identity that shares the NFT's soul URI
//      · setAgentMetadata   — annotate that identity (e.g. point at the TBA)
//
//   B. GENERATE (no chain): build a runnable Virtuals (GAME + ACP-v2) agent
//      monorepo from the NFT's soul, LLM-expanded with the user's own key. The
//      ACP agent itself (P256 signer, keyring, 24/7 daemon) can't run in a
//      browser — the repo is the terminal hand-off, prefilled to one paste.
//
// The soul document (ai_soul.json / neural_soul.md) is deterministic from
// soul.ts; only the code/prose is LLM-authored. No secret is ever written into
// a generated file — .env.example is placeholders only.

import { ethers } from "ethers";
import { BASE, type Eip1193Provider } from "../config";
import { ERC6551_REGISTRY, ERC6551_IMPLEMENTATION } from "./deploy";
import { buildAiSoul, soulToMarkdown, type SoulConfig, type AiSoul } from "../soul";
import { streamChat } from "../llm";

/** ERC-8004 Identity Registry on Base (iCLONE #55101 / VEGETA #58099 live here). */
export const ERC8004_IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const FORGE_ABI = [
  "function tokenAccount(uint256 tokenId) view returns (address)",
  "function createTokenAccount(uint256 tokenId) returns (address)",
];

// ERC-8004 is an evolving EIP — this is the stable subset. If a live registry
// differs, pull its ABI from BaseScan.
const ERC8004_ABI = [
  "function register(string agentURI) returns (uint256 agentId)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];

async function baseSigner(provider: Eip1193Provider) {
  const bp = new ethers.BrowserProvider(provider as any);
  const net = await bp.getNetwork();
  if (Number(net.chainId) !== BASE.id) throw new Error("Switch the wallet to Base first");
  return bp.getSigner();
}

// ── A. on-chain binds ────────────────────────────────────────────────────────

/** The deterministic ERC-6551 account for a token — no transaction. */
export async function predictTokenAccount(contract: string, tokenId: bigint): Promise<string> {
  const rpc = new ethers.JsonRpcProvider(BASE.rpc);
  const c = new ethers.Contract(contract, FORGE_ABI, rpc);
  return (await c.tokenAccount!(tokenId)) as string;
}

/** Deploy the NFT's token-bound account (its agent wallet). One tx; anyone may call. */
export async function createTokenAccount(
  provider: Eip1193Provider,
  contract: string,
  tokenId: bigint,
): Promise<{ tba: string; txHash: string }> {
  const signer = await baseSigner(provider);
  const c = new ethers.Contract(contract, FORGE_ABI, signer);
  const predicted = (await c.tokenAccount!(tokenId)) as string;
  const tx = await (c as any).createTokenAccount(tokenId);
  await tx.wait();
  return { tba: predicted, txHash: tx.hash as string };
}

/** Register an ERC-8004 identity whose agentURI is the NFT's sealed soul/metadata
 *  URI — the CLONE FRAME NFT and the 8004 identity now share one soul document. */
export async function registerErc8004(
  provider: Eip1193Provider,
  agentURI: string,
): Promise<{ agentId: bigint; txHash: string }> {
  const signer = await baseSigner(provider);
  const c = new ethers.Contract(ERC8004_IDENTITY, ERC8004_ABI, signer);
  const tx = await (c as any).register(agentURI);
  const receipt = await tx.wait();
  let agentId = 0n;
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = c.interface.parseLog(log);
      if (parsed?.name === "Registered") {
        agentId = parsed.args.agentId as bigint;
        break;
      }
    } catch {
      /* not our event */
    }
  }
  return { agentId, txHash: tx.hash as string };
}

/** Annotate an ERC-8004 identity (e.g. key "agentWallet" → the TBA address). */
export async function setAgentMetadata(
  provider: Eip1193Provider,
  agentId: bigint,
  key: string,
  value: string,
): Promise<string> {
  const signer = await baseSigner(provider);
  const c = new ethers.Contract(ERC8004_IDENTITY, ERC8004_ABI, signer);
  const bytes = ethers.toUtf8Bytes(value);
  const tx = await (c as any).setMetadata(agentId, key, bytes);
  await tx.wait();
  return tx.hash as string;
}

// ── B. generate a runnable agent monorepo ────────────────────────────────────

export interface AgentCard {
  name: string;
  slug: string;
  description: string;
  tokenURI: string;
  chainId: 8453;
  contract: string;
  tokenId: string; // "" / "dry-run" when not minted
  wallet: string; // the TBA (or owner) — the agent's on-chain wallet
  runtime: "game" | "acp-v2";
  offerings: { name: string; priceUsd: number; description: string }[];
  soul: SoulConfig;
  aiSoul: AiSoul;
}

export const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "agent";

export function buildAgentCard(
  soul: SoulConfig,
  opts: {
    tokenId?: string;
    contract?: string;
    tba?: string;
    tokenURI?: string;
    runtime?: "game" | "acp-v2";
    offerings?: { name: string; priceUsd: number; description: string }[];
  },
): AgentCard {
  const name = soul.name || soul.preset || "iCLONE Agent";
  return {
    name,
    slug: slugify(name),
    description: soul.personality || `An autonomous agent booted from the ${name} neural soul.`,
    tokenURI: opts.tokenURI ?? "",
    chainId: 8453,
    contract: opts.contract ?? "",
    tokenId: opts.tokenId ?? "dry-run",
    wallet: opts.tba ?? "",
    runtime: opts.runtime ?? "acp-v2",
    offerings: opts.offerings?.length
      ? opts.offerings
      : [{ name: "consult", priceUsd: 5, description: `A consultation with ${name}.` }],
    soul,
    aiSoul: buildAiSoul(soul, opts.tokenId || "001", soul.memoryAnchor),
  };
}

/** ACP offerings — two schemas: CLI uses price:{type,value}; the web "Import
 *  Agent Offerings" UI uses priceV2:{type,value}. Names camelCase, no spaces. */
export function buildOfferings(card: AgentCard, mode: "cli" | "webui"): unknown {
  const priceKey = mode === "cli" ? "price" : "priceV2";
  return {
    offerings: card.offerings.map((o) => ({
      name: o.name.replace(/[^a-zA-Z0-9]+/g, ""),
      description: o.description,
      [priceKey]: { type: "fixed", value: o.priceUsd },
      requirement: { type: "object", properties: { brief: { type: "string" } } },
    })),
  };
}

export function buildEnvExample(card: AgentCard): string {
  return [
    "# iIrys Frame — generated agent. PLACEHOLDERS ONLY; never commit real keys.",
    "GAME_API_KEY=your_game_api_key_here",
    "ANTHROPIC_API_KEY=sk-ant-your_key_here   # or VIRTUALS_COMPUTE_* as a 402 fallback",
    `BRAIN_MODEL=${card.aiSoul.base_model}`,
    "ACP_CONFIG_DIR=./.acp                    # per-agent isolated config dir",
    "ACP_CHAIN_ID=8453",
    `AGENT_NAME=${card.name}`,
    `AGENT_WALLET_ADDRESS=${card.wallet || "0xYOUR_AGENT_TBA"}`,
    "OWNER_WALLET_ADDRESS=0xYOUR_OWNER_WALLET",
    "",
  ].join("\n");
}

/** The exact acp-cli command block to bring the agent online (terminal). */
export function buildCreateAgentScript(card: AgentCard): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `# Bring "${card.name}" online on Virtuals ACP (Base). Run on a machine with`,
    "# Node ≥20, a keyring, and a browser to approve the signer (5-min window).",
    "",
    "npm i -g @virtuals-protocol/acp-cli",
    "acp configure                       # Privy OAuth as the OWNER",
    "acp agent create --signer --policy restricted",
    'AGENT_ID="<paste the id from create>"',
    'acp agent add-signer --agent-id "$AGENT_ID" --policy restricted --no-wait --json',
    "#   → approve the returned https://app.virtuals.io/... URL in the browser as OWNER",
    "acp wallet topup --chain-id 8453 --method coinbase --amount 25",
    "acp offering create --file acp/offerings.cli.json",
    "acp offering list --json            # confirm the offering UUIDs",
    "",
  ].join("\n");
}

function readme(card: AgentCard): string {
  return `# ${card.name}

An autonomous AI agent forged with **iIrys Frame** from the \`${card.soul.preset}\` neural soul.
Runtime: **${card.runtime === "game" ? "Virtuals GAME" : "Virtuals ACP v2"}** · Chain: **Base (8453)**.

## Identity
- iNFT contract: \`${card.contract || "(not minted)"}\`
- tokenId: \`${card.tokenId}\`
- Agent wallet (ERC-6551 TBA): \`${card.wallet || "(create it in iIrys Frame → Agent → Bind on-chain)"}\`
- Soul URI: ${card.tokenURI || "(seal the item in iIrys Frame to get the tokenURI)"}

Whoever holds the iNFT controls this agent. The soul in \`soul/\` is the same
\`ai_soul\` sealed into the token's metadata — the runtime boots from it.

## Run (terminal — this cannot run in a browser)
The ACP agent needs Node ≥20, a keyring, a hardware-bound P256 signer, and a
persistent host. iIrys Frame generated everything below; you run it.

\`\`\`bash
cp .env.example .env && $EDITOR .env      # fill your keys (never commit them)
npm install
bash scripts/create-agent.sh              # onboard on Virtuals ACP
npm run dev                               # boot the agent loop
\`\`\`

## Layout
- \`soul/\` — the neural soul (deterministic from the iNFT).
- \`src/\` — GAME agent + ACP-v2 worker + capability workers.
- \`acp/\` — offerings in **both** schemas (CLI \`price\`, web UI \`priceV2\`).
- \`scripts/create-agent.sh\` — the acp-cli onboarding block.

MIT © ${new Date().getFullYear()} — generated by iIrys Frame (CLONE FRAME).
`;
}

const PKG_JSON = (card: AgentCard) =>
  JSON.stringify(
    {
      name: card.slug,
      version: "0.1.0",
      private: true,
      type: "module",
      engines: { node: ">=20" },
      scripts: { dev: "tsx src/index.ts", typecheck: "tsc --noEmit" },
      dependencies: {
        "@virtuals-protocol/game": "^0.1.14",
        "@virtuals-protocol/acp-node-v2": "^0.1.7",
        "game-acp-plugin": "^0.2.9",
        dotenv: "^16.4.5",
      },
      devDependencies: { tsx: "^4.19.0", typescript: "^5.6.0" },
      license: "MIT",
    },
    null,
    2,
  );

const TSCONFIG = JSON.stringify(
  { compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, esModuleInterop: true, skipLibCheck: true, outDir: "dist" }, include: ["src"] },
  null,
  2,
);

const GITIGNORE = ["node_modules", "dist", ".env", ".env.local", "signer-keys.json", "*.keyring", ".acp/"].join("\n") + "\n";

const INDEX_TS = `import "dotenv/config";
import { boot } from "./agent";

boot().catch((e) => {
  console.error("agent failed to boot:", e);
  process.exit(1);
});
`;

/** Deterministic files (no LLM). The LLM only fleshes src/agent.ts + workers + README prose. */
function deterministicFiles(card: AgentCard): Record<string, string> {
  return {
    "README.md": readme(card),
    LICENSE: mitLicense(),
    ".gitignore": GITIGNORE,
    ".env.example": buildEnvExample(card),
    "package.json": PKG_JSON(card),
    "tsconfig.json": TSCONFIG,
    "soul/neural_soul.md": soulToMarkdown(card.soul),
    "soul/ai_soul.json": JSON.stringify(card.aiSoul, null, 2),
    "src/index.ts": INDEX_TS,
    "acp/offerings.cli.json": JSON.stringify(buildOfferings(card, "cli"), null, 2),
    "acp/offerings.webui.json": JSON.stringify(buildOfferings(card, "webui"), null, 2),
    "scripts/create-agent.sh": buildCreateAgentScript(card),
  };
}

function mitLicense(): string {
  return `MIT License

Copyright (c) ${new Date().getFullYear()} CLONE FRAME (devclone20)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction... (standard MIT text).
`;
}

const AGENT_TS_FALLBACK = (card: AgentCard) => `import { readFileSync } from "node:fs";
import { GameAgent } from "@virtuals-protocol/game";

// Read the soul without JSON import assertions (stable across Node 20–22+).
const soul = JSON.parse(readFileSync(new URL("../soul/ai_soul.json", import.meta.url), "utf8"));

// Booted from the iNFT's neural soul. Whoever holds token ${card.tokenId} owns this agent.
export async function boot() {
  const agent = new GameAgent(process.env.GAME_API_KEY!, {
    name: ${JSON.stringify(card.name)},
    goal: soul.system_prompt.slice(0, 240),
    description: soul.personality,
    workers: [],
  });
  await agent.init();
  // ACP worker wiring lives in src/acp.ts — embed offering_id in every job's requirements.
  await agent.run(60, { verbose: true });
}
`;

const ACP_TS = `// ACP v2 worker wiring. Every created job MUST embed offering_id in its
// requirements, or the provider defaults to \\$0.25/unknown and delivers garbage.
// See scripts/create-agent.sh to onboard, then implement the JobSession handlers.
export const OFFERINGS_NOTE =
  "Publish acp/offerings.cli.json with 'acp offering create --file'; requirement is singular; names camelCase.";
`;

/** Build the full monorepo file map. When `fleshOut` and an LLM key are set, the
 *  brain/prose files are authored by the user's own model; otherwise a working
 *  deterministic fallback ships. */
export async function generateAgentRepo(
  card: AgentCard,
  opts: { fleshOut?: boolean; providerId?: string; model?: string; onText?: (d: string) => void } = {},
): Promise<Record<string, string>> {
  const files = deterministicFiles(card);
  files["src/acp.ts"] = ACP_TS;

  if (opts.fleshOut && opts.providerId && opts.model) {
    try {
      const system =
        "You write a single TypeScript file for a Virtuals GAME agent. Output ONLY code, no markdown fences. " +
        "Export `async function boot()` that constructs a GameAgent from process.env.GAME_API_KEY and the " +
        "soul (read ai_soul.json via `JSON.parse(readFileSync(new URL(\"../soul/ai_soul.json\", import.meta.url), \"utf8\"))` " +
        "— never use JSON import assertions), defines GameWorker/GameFunction handlers for the agent's offerings, " +
        "and calls agent.run(60). Never write signing, key, or policy code.";
      const prompt =
        `Agent name: ${card.name}\nRuntime: ${card.runtime}\nPersonality: ${card.soul.personality}\n` +
        `System prompt (soul): ${card.aiSoul.system_prompt}\nOfferings: ${JSON.stringify(card.offerings)}\n` +
        `Write src/agent.ts. Read the soul from ../soul/ai_soul.json with fs.readFileSync (no import assertions).`;
      const code = await streamChat({
        providerId: opts.providerId,
        model: opts.model,
        system,
        history: [{ role: "user", content: prompt }],
        onText: opts.onText ?? (() => {}),
      });
      files["src/agent.ts"] = code.replace(/^```[a-z]*\n?|```$/g, "").trim() + "\n";
    } catch {
      files["src/agent.ts"] = AGENT_TS_FALLBACK(card);
    }
  } else {
    files["src/agent.ts"] = AGENT_TS_FALLBACK(card);
  }
  return files;
}
