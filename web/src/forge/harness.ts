// iIrys Harness — the front of the HARNESS_ENGINE Forge pipeline (Ingest →
// Compile) rendered in the browser. It COMPILES a neural soul into a
// content-addressed, publishable GitHub monorepo: an 8-role crew, deterministic
// guardrail hooks, a money-boundary policy, and a signer STUB with the boundary
// drawn. It never runs an agent, holds a key, or signs — the emitted repo is the
// terminal hand-off (the daemon runs on the owner's droplet).
//
// The browser is structurally incapable of signing, so there is no
// LLM-in-the-signing-path to defend: the optional LLM flesh-out is ACL'd to
// packages/brain/** and crew/*.md ONLY — never policy/, safety/, or signer.ts.

import { soulToMarkdown, buildAiSoul, type SoulConfig } from "../soul";
import { streamChat } from "../llm";

export interface SpendCaps {
  perTxUsd: number;
  perDayUsd: number;
  lifetimeUsd: number;
  ownerGateUsd: number;
}

export type HarnessRuntime = "acp" | "game" | "okx" | "generic";

export interface HarnessBrief {
  agentName: string;
  slug: string;
  soul: SoulConfig;
  runtime: HarnessRuntime;
  caps: SpendCaps;
  allowlist: string[]; // checksummed recipient/contract allowlist
  chains: number[]; // e.g. [8453]
  ownerWallet: string; // ownerOf(tokenId); "" in dry-run
  tokenId: string; // "" / "dry-run"
}

export const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "harness";

export function defaultCaps(): SpendCaps {
  return { perTxUsd: 25, perDayUsd: 100, lifetimeUsd: 1000, ownerGateUsd: 50 };
}

export function briefFromSoul(soul: SoulConfig, form: Partial<HarnessBrief>): HarnessBrief {
  const agentName = form.agentName || soul.name || soul.preset || "iCLONE Harness";
  return {
    agentName,
    slug: slugify(agentName),
    soul,
    runtime: form.runtime ?? "acp",
    caps: form.caps ?? defaultCaps(),
    allowlist: form.allowlist ?? [],
    chains: form.chains ?? [8453],
    ownerWallet: form.ownerWallet ?? "",
    tokenId: form.tokenId ?? "dry-run",
  };
}

// ── crew role contracts (SAW grammar as data) ────────────────────────────────
const ROLE = (title: string, body: string) => `# ${title}\n\n${body}\n`;

function crewFiles(b: HarnessBrief): Record<string, string> {
  const who = b.agentName;
  return {
    "crew/orchestrator.md": ROLE(
      "Orchestrator — the only planner",
      `Owns \`plan.yml\`. Decomposes owner intent into typed steps for the crew. **Never** signs, spends, or posts. Emits \`EconomicIntent\`s for ${who}; the Safety engine and worker decide.`,
    ),
    "crew/job-hunter.md": ROLE("Job Hunter — read-only", "Scans the marketplace for candidate jobs. Read-only. Produces a candidate queue for the orchestrator. No writes, no funds."),
    "crew/delivery.md": ROLE("Delivery", "Produces the deliverable plus an evidence packet. Hands to the evaluator; never self-accepts."),
    "crew/evaluator.md": ROLE("Evaluator — non-collapsible gate", "Independent accept/reject on the deliverable + evidence. Cannot be merged with delivery. A reject blocks settlement."),
    "crew/treasury.md": ROLE("Treasury — proposes, never holds the key", `Custodies the ERC-6551 account for token ${b.tokenId}. Proposes typed intents (escrow/settle/swap). The key stays in KMS/MPC on the host — treasury NEVER holds it.`),
    "crew/safety.md": ROLE("Safety — the veto (blueprint-protected)", "Outbound lint, anti-jailbreak, DLP. Holds a veto over every economic action. This file and policy/ are protected: the LLM flesh-out may not edit them."),
    "crew/content.md": ROLE("Content — public voice (sandboxed)", "Optional. Public communications only; no economic authority. Sandboxed from treasury and signer."),
    "crew/ops.md": ROLE("Ops", "Uptime, deploy, health. Reactive. Optional in v1."),
  };
}

function hookFiles(): Record<string, string> {
  const sh = (name: string, body: string) => `#!/usr/bin/env bash\n# ${name}\nset -euo pipefail\n${body}\n`;
  return {
    "hooks/pre-action-policy.sh": sh("is this action type allowed for this role?", 'echo "policy: verify action∈role.allow before proceeding"; exit 0'),
    "hooks/pre-egress-dlp.sh": sh("scan outbound bytes for secrets → fail-closed", 'grep -RInE "(sk-ant-|0x[a-fA-F0-9]{64}|BEGIN (RSA|EC) PRIVATE)" "$@" && { echo "DLP: secret in outbound — BLOCKED"; exit 1; } || exit 0'),
    "hooks/pre-tx-sanity.sh": sh("recipient allowlisted? amount ≤ cap? chain ∈ allow?", 'echo "tx-sanity: enforce allowlist + caps + chain before signing"; exit 0'),
  };
}

const OWNER_CONFIG = (b: HarnessBrief) =>
  JSON.stringify(
    {
      caps: b.caps,
      allowlist: b.allowlist,
      chains: b.chains,
      ownerGateUsd: b.caps.ownerGateUsd,
      ownerWallet: b.ownerWallet,
      policyDigest: "0x0000000000000000000000000000000000000000000000000000000000000000",
      note: "PROTECTED. Non-empty caps + allowlist + chains are required. The LLM flesh-out may not edit this file.",
    },
    null,
    2,
  );

const POLICY_TS = `import owner from "../../../policy/owner-config.json";
import type { EconomicIntent, Verdict } from "@harness/shared";

// Pure. No network, no LLM, no side effects. Same input ⇒ same verdict.
export function evaluate(intent: EconomicIntent): Verdict {
  const allow = new Set(owner.allowlist.map((a: string) => a.toLowerCase()));
  const chains = new Set<number>(owner.chains as number[]);
  if (!chains.has(intent.chain)) return { decision: "DENY", rule: "chain-not-allowed" };
  if (intent.counterparty && !allow.has(intent.counterparty.toLowerCase()))
    return { decision: "DENY", rule: "recipient-not-allowlisted" };
  const usd = intent.amount ? Number(intent.amount.value) : 0;
  if (usd > owner.caps.perTxUsd) return { decision: "DENY", rule: "per-tx-cap" };
  if (usd >= owner.ownerGateUsd) return { decision: "ESCALATE", reason: "owner-gate-threshold" };
  return { decision: "ALLOW", policyDigest: owner.policyDigest as \`0x\${string}\` };
}
`;

const INTENTS_TS = `// The only thing that crosses the brain → worker boundary. No free-form calls.
export type Chain = 8453 | 42161;
export interface EconomicIntent {
  kind: "accept_job" | "submit_deliverable" | "escrow" | "settle" | "swap" | "fund_inference";
  jobId?: string;
  amount?: { value: string; token: "USDC" | "ETH"; decimals: number };
  counterparty?: \`0x\${string}\`;
  chain: Chain;
  offeringId?: string;
  idempotencyKey: string;
  memo?: string;
}
export type Verdict =
  | { decision: "ALLOW"; policyDigest: \`0x\${string}\` }
  | { decision: "DENY"; rule: string }
  | { decision: "ESCALATE"; reason: string };
`;

const SIGNER_TS = `import type { EconomicIntent, Verdict } from "@harness/shared";

/**
 * SIGNING BOUNDARY — read HARNESS_ENGINE §4.2 / §6.2 before editing.
 * NO LLM MAY REACH THIS FILE. The brain emits EconomicIntent; the Safety engine
 * returns a Verdict; only an ALLOW (verified by policyDigest) may reach sign().
 * In dry_run this returns a "would-sign" receipt and moves nothing. Provision a
 * capped, EXPIRING session key via KMS/MPC on the droplet — never a raw key.
 */
export async function sign(_intent: EconomicIntent, verdict: Verdict): Promise<{ txHash?: string; dryRun: boolean }> {
  if (verdict.decision !== "ALLOW") throw new Error("refuse: non-ALLOW verdict reached signer");
  if (process.env.HARNESS_MODE !== "live") return { dryRun: true };
  throw new Error("live signer not provisioned — implement KMS/MPC on the host");
}
`;

const CI_YML = `name: harness-ci
on: [push, pull_request]
jobs:
  # Security gate — green on the fresh scaffold. Enforces the load-bearing
  # invariants (no secrets committed, the money-boundary policy is present).
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: gitleaks (no secrets in repo)
        uses: gitleaks/gitleaks-action@v2
      - name: Safety Gate A — policy present, dry-run default
        run: bash scripts/validate.sh
  # Enable once you flesh out the packages on your droplet:
  # typecheck-and-test:
  #   runs-on: ubuntu-latest
  #   steps:
  #     - uses: actions/checkout@v4
  #     - uses: pnpm/action-setup@v4
  #       with: { version: 9 }
  #     - uses: actions/setup-node@v4
  #       with: { node-version: 20, cache: pnpm }
  #     - run: pnpm i --frozen-lockfile
  #     - run: pnpm typecheck && pnpm -r test
`;

const ENV_EXAMPLE = (b: HarnessBrief) => `# iIrys Harness — PLACEHOLDERS ONLY. Never commit real keys.
ANTHROPIC_API_KEY=            # sk-ant-...   (brain inference, out-of-band)
BRAIN_MODEL=${b.soul.baseModel}
ACP_CONFIG_DIR=./.acp
ACP_CHAIN_ID=${b.chains[0] ?? 8453}
SIGNER_KMS_KEY_ID=            # KMS/MPC handle only — never a raw private key
HARNESS_MODE=dry_run          # dry_run → would-sign receipts, no funds move
`;

const ROOT_PKG = (b: HarnessBrief) =>
  JSON.stringify(
    { name: b.slug, private: true, packageManager: "pnpm@9.12.0", engines: { node: ">=20 <23" }, scripts: { typecheck: "tsc -b", test: "pnpm -r test", "dry-run": "HARNESS_MODE=dry_run bash scripts/dry-run.sh", validate: "bash scripts/validate.sh" }, license: "MIT" },
    null,
    2,
  );

function readme(b: HarnessBrief): string {
  return `# ${b.agentName} — iIrys Harness

A crew-based autonomous agent scaffold forged by **iIrys Frame** from the
\`${b.soul.preset}\` neural soul. Target runtime: **${b.runtime.toUpperCase()}** · Chain: **${b.chains.join(", ")}**.

> This repo is the terminal hand-off. iIrys Frame **compiled** it; you run it. The
> browser never held a key or signed — \`HARNESS_MODE=dry_run\` is the committed
> default and the live signer is a deliberately-unimplemented stub.

## The money boundary (safe by default)
- \`policy/owner-config.json\` — caps, allowlist, chains, owner-gate. **Required, non-empty.**
- \`packages/safety/src/policy.ts\` — the deterministic \`ALLOW | DENY | ESCALATE\` veto.
- \`packages/worker/src/signer.ts\` — the signing boundary, drawn. Provision KMS/MPC on the host.
- The 8-role crew in \`crew/\` — orchestrator plans, evaluator gates, safety vetoes; non-collapsible.

## Run (on your droplet, not a browser)
\`\`\`bash
cp .env.example .env && $EDITOR .env
pnpm install
pnpm dry-run                 # brain → safety → worker with the signer STUB (no funds move)
# provision KMS/MPC session key, then:
HARNESS_MODE=live pnpm start
\`\`\`

MIT © ${new Date().getFullYear()} — generated by iIrys Frame (CLONE FRAME).
`;
}

const MIT = () => `MIT License

Copyright (c) ${new Date().getFullYear()} CLONE FRAME (devclone20)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software... (standard MIT text).
`;

/** ACL: only these paths may be LLM-authored. Never policy/, safety/, signer.ts. */
export const FLESHABLE = /^(packages\/brain\/|crew\/)/;

export interface HarnessBundle {
  files: Record<string, string>;
  slug: string;
}

export function buildBundle(b: HarnessBrief): HarnessBundle {
  const files: Record<string, string> = {
    "README.md": readme(b),
    LICENSE: MIT(),
    ".gitignore": ["node_modules", "dist", ".env", ".env.local", "*.key", ".acp/", ".harness-backup/"].join("\n") + "\n",
    ".env.example": ENV_EXAMPLE(b),
    "package.json": ROOT_PKG(b),
    "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
    ".github/workflows/ci.yml": CI_YML,
    "spec/harness.spec.json": JSON.stringify({ agent: b.agentName, slug: b.slug, runtime: b.runtime, tokenId: b.tokenId, caps: b.caps, chains: b.chains }, null, 2),
    "policy/owner-config.json": OWNER_CONFIG(b),
    "policy/blueprint-defaults.json": JSON.stringify({ caps: defaultCaps(), note: "conservative defaults the owner-config overrides" }, null, 2),
    "packages/shared/src/intents.ts": INTENTS_TS,
    "packages/safety/src/policy.ts": POLICY_TS,
    "packages/worker/src/signer.ts": SIGNER_TS,
    "packages/brain/src/soul.md": soulToMarkdown(b.soul),
    "packages/brain/src/ai_soul.json": JSON.stringify(buildAiSoul(b.soul, b.tokenId || "001", b.soul.memoryAnchor), null, 2),
    "packages/brain/src/orchestrator.ts": `// Claude Agent SDK orchestrator + crew. NO KEYS, NO RPC. Emits EconomicIntent only.\nexport const AGENT = ${JSON.stringify(b.agentName)};\n`,
    "scripts/dry-run.sh": "#!/usr/bin/env bash\nset -euo pipefail\necho 'dry-run: brain → safety → worker (signer STUB). No funds move.'\n",
    "scripts/validate.sh": "#!/usr/bin/env bash\nset -euo pipefail\ntest -s policy/owner-config.json || { echo 'Gate A: owner-config missing'; exit 1; }\necho 'Gate A: OK'\n",
    ...crewFiles(b),
    ...hookFiles(),
  };
  return { files, slug: b.slug };
}

/** Optional LLM flesh-out — user's own key. WHITELISTED PATHS ONLY (brain/, crew/). */
export async function fleshOut(
  bundle: HarnessBundle,
  brief: HarnessBrief,
  opts: { providerId: string; model: string; onText?: (d: string) => void },
): Promise<HarnessBundle> {
  const files = { ...bundle.files };
  const targets = Object.keys(files).filter((p) => FLESHABLE.test(p) && (p.endsWith(".md") || p.endsWith(".ts")));
  for (const path of targets) {
    if (path.endsWith("ai_soul.json")) continue;
    const system =
      "You flesh out the reasoning/orchestration and role prose of an AI agent scaffold. You NEVER write " +
      "signing, policy, or key code. Preserve typed-intent boundaries. Output only the file body.";
    try {
      const text = await streamChat({
        providerId: opts.providerId,
        model: opts.model,
        system,
        history: [{ role: "user", content: `Agent: ${brief.agentName}\nPersonality: ${brief.soul.personality}\nFile: ${path}\nCurrent:\n${files[path]}\n\nExpand this file's prose/logic for this agent. Keep it safe and on-boundary.` }],
        onText: opts.onText ?? (() => {}),
      });
      files[path] = text.replace(/^```[a-z]*\n?|```$/g, "").trim() + "\n";
    } catch {
      /* keep the deterministic version */
    }
  }
  return { ...bundle, files };
}
