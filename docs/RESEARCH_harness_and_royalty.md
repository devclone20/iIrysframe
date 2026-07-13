# iIrys Frame — Harness Forge & Developer-Support Royalty

> Engineering spec. Two features, one app. **Part 1** maps `HARNESS_ENGINE` into a
> pragmatic in-app "iIrys Harness" scaffold generator. **Part 2** designs the
> Solidity + UX for an opt-in 1–5% developer-support fee (perpetual or first-sale).
>
> Repo: `github.com/devclone20/iIrysframe`
> Stack: React + Vite + TS (`web/`), Foundry + OZ + ERC721A (`contracts/`).
> Ground truth read: `contracts/src/CloneForge.sol`, `web/src/forge/deploy.ts`,
> `web/src/components/{Create,CreateSteps,Launch}.tsx`, `web/src/{llm,soul,irys}.ts`,
> `web/src/forge/{forgeStore,manifest}.ts`, and `HARNESS_ENGINE/` (master + blueprint).

---

## Part 1 — HARNESS_ENGINE → "iIrys Harness" (in-app agent forge)

### 1.0 The framing that makes this shippable

`HARNESS_ENGINE.md` is explicit (§0): the full Harness is a **long-running money-handling
daemon** — systemd, Postgres event log, MPC/KMS signer, fleet sync, OTel, canary graduation.
**None of that can or should run in a browser tab.** A React SPA cannot hold a hot key, cannot
survive a reboot, cannot supervise a daemon, and must never sign an autonomous economic action.

So the in-app "iIrys Harness" is **not the Harness and not the Forge runtime**. It is exactly the
front of the Forge pipeline — `Ingest → Compile` (§7.1) — rendered as a wizard that emits a
**content-addressed Harness Bundle as a publishable GitHub monorepo**. The app is
`harness compile-soul` + `harness forge --dry-run` and stops there. Everything that touches money,
keys, or uptime is emitted *as code and docs the user runs on their own machine* — the terminal
handoff. This preserves the spec's load-bearing invariant (§4.2, §6.1) trivially: **the browser is
structurally incapable of signing, so there is no LLM-in-the-signing-path to defend against — the
signing path does not exist in the app at all.**

### 1.1 In-scope (v1, in-browser) vs out-of-scope (terminal / droplet)

Be ruthless. The app generates artifacts; it never executes the organism.

| Concern | v1 in-app | Rationale |
|---|---|---|
| **Brief intake** (agent identity, offerings, caps, allowlist, target runtime) | ✅ IN | It's a form; reuses `SoulConfig` from `soul.ts` as the genome. |
| **Ingest → Spec** (`harness.spec.json`, `specHash`) | ✅ IN (soft) | Canonical-JSON the brief; hash it in-browser. Read-only chain reads (tokenId/owner) optional via the existing `ethers.JsonRpcProvider(BASE.rpc)`. |
| **Compile → Bundle** (crew contracts, hooks, policy, manifest, worker/brain/safety stubs) | ✅ IN | Pure-function file emit from templates. Deterministic. No runtime. |
| **Crew role contracts** (`crew/*.md`) | ✅ IN | Static text parameterized by the brief. This is the SAW grammar (§2.1) as data. |
| **Layer-1 hooks** (`hooks/*.sh`) | ✅ IN | Static deterministic guardrails, emitted verbatim. |
| **Policy `owner-config.json`** (caps/allowlist/kill-switch) | ✅ IN | Projected from the brief's caps. This is the off-chain ERC-8196 pre-impl (§5.2). |
| **ACP / GAME / OKX wiring stubs** | ✅ IN (stubs) | Real `package.json` + typed entrypoints; SDK version pinned; handlers left as documented TODOs. |
| **README / LICENSE (MIT) / .gitignore / CI** | ✅ IN | Copy-paste real (§1.3). |
| **Deliver**: ZIP download **and** Irys-sealed bundle | ✅ IN | Reuses `irys.ts` + a path-manifest (like `manifest.ts`). |
| **Optional LLM flesh-out** of the *brain* prompt/offering logic | ✅ IN (gated) | Uses `web/src/llm.ts` with the user's BYO key. **Never** touches `policy.ts`/`signer.ts`. |
| The **Operate loop / daemon** (systemd, heartbeat, anti-dormancy) | ❌ OUT → terminal | Requires a supervised host. Shipped as code in the repo; run by the user. |
| **Signer / MPC / KMS / session keys** | ❌ OUT → terminal | Key custody never enters a browser. Emitted as a **stub with the boundary drawn** (§1.4). |
| **Durable event log (Postgres)**, OTel, fleet sync, canary, retire/sweep | ❌ OUT → terminal | Infra. Migrations + unit templates shipped; provisioned by the user. |
| **Any autonomous on-chain action** or real ACP job | ❌ OUT (hard) | The app forges the crew; it never *is* the crew. Dry-run default in the repo. |
| On-chain **attestation** of the blueprint digest | ❌ OUT (v2) | Optional `harness attest`; not needed to publish a repo. |

**One-line contract:** *the app compiles a soul into a repo you can publish; you run the daemon.*

### 1.2 Where it lives in the app

A soul is already a first-class wizard object (`Create.tsx → StepSouls`, `soul.ts`). The Harness is
its natural extension: an agent needs a body. Two integration options, recommend **(A)**:

- **(A) A dedicated "Harness" surface** (new tab alongside Create/Launch, or a step after `souls`).
  Decoupled from the mint: it references `tokenId` when the soul's item is minted, else `"dry-run"`.
  Rationale: forging an agent's repo is independent of sealing/minting art; coupling them forces a
  mint before a repo, which is wrong (you dry-run the agent *before* committing on-chain identity).
- (B) A button in `Launch.tsx` ("Forge a Harness for this soul"). Simpler, but buries a major feature
  under mint and implies mint-first. Use only if tab budget is tight.

The control is only meaningful when `wiz.soulsOn` — gate its visibility on a selected `SoulConfig`.

### 1.3 The monorepo scaffold (copy-paste real)

TS-first (the ACP SDK — `@virtuals-protocol/acp-node` — is TS, and the app is TS, so templating is
one language). A Python `pyproject`/`agent.py` variant is a v1.1 flag; the tree below is the emitted
default. `<slug>` = kebab-case agent name.

```
<slug>/
├── README.md                     # what this is, the 3-mode deploy, dry-run-first, terminal handoff
├── LICENSE                       # MIT (author = owner wallet / handle)
├── .gitignore                    # node, env, keys, build, .harness-backup
├── .env.example                  # EVERY secret as a placeholder — NEVER a real key
├── package.json                  # pnpm workspaces root; scripts: dry-run, validate, test, typecheck
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── bundle.lock.json              # pins acp-node version+hash, chain contract addrs, specHash, forgeVersion
├── .harness-manifest.yml         # the customization contract (from brief) — see HARNESS_ENGINE §7.2
├── .github/workflows/ci.yml      # typecheck + test + gitleaks + Safety Gate A (static invariants)
├── spec/
│   └── harness.spec.json         # normalized brief (canonical JSON) + specHash — provenance
├── crew/                         # Layer 3 — the 8 role contracts (SAW grammar, economic content)
│   ├── orchestrator.md           # the only planner; owns plan.yml; NO sign/spend/post
│   ├── job-hunter.md             # read-only marketplace scan; candidate queue
│   ├── delivery.md               # produces the deliverable + evidence packet
│   ├── evaluator.md              # independent accept/reject gate (non-collapsible)
│   ├── treasury.md               # ERC-6551 custody; proposes typed intents; NEVER holds the key
│   ├── safety.md                 # the veto; outbound lint; anti-jailbreak (blueprint-protected)
│   ├── content.md                # public voice (sandboxed); optional in v1
│   └── ops.md                    # uptime/deploy/health; reactive; optional in v1
├── hooks/                        # Layer 1 — deterministic guardrails (bash, exit-block)
│   ├── pre-action-policy.sh      # is this action type allowed for this role?
│   ├── pre-egress-dlp.sh         # scan outbound bytes for secrets/keys → fail-closed
│   └── pre-tx-sanity.sh          # recipient allowlisted? amount ≤ cap? chain ∈ allow?
├── policy/
│   ├── owner-config.json         # PROTECTED: caps, allowlist, kill-switch, risk gate (from brief)
│   └── blueprint-defaults.json   # conservative defaults the owner-config overrides
├── packages/
│   ├── shared/                   # typed intents + schemas (the IPC contract)
│   │   ├── package.json
│   │   └── src/{intents.ts,schema.ts,index.ts}
│   ├── brain/                    # Claude Agent SDK orchestrator+crew — NO KEYS, NO RPC
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/{index.ts,orchestrator.ts,soul.md}
│   ├── safety/                   # deterministic policy engine (veto sidecar)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/{policy.ts,index.ts,policy.test.ts}
│   └── worker/                   # acp-node-v2 worker — the ONLY process near a signer
│       ├── package.json
│       ├── tsconfig.json
│       └── src/{index.ts,acp.ts,signer.ts}   # signer.ts = STUB, boundary drawn
├── adapters/
│   ├── acp/README.md             # Virtuals ACP v2 wiring (default runtime)
│   ├── game/README.md            # GAME framework wiring (alt runtime)
│   └── okx/README.md             # OKX.ai / X Layer wiring (alt runtime)
└── scripts/
    ├── dry-run.sh                # runs brain→safety→worker with signer STUB (no funds move)
    └── validate.sh               # Gate A/B/C static checks before any mainnet thought
```

**Purpose of each load-bearing file** (the rest are conventional):

- `.harness-manifest.yml` — binds this bundle to one agent/iNFT; carries `identity`, `substitutions`,
  `protected` (`policy/owner-config.json`, `crew/safety.md`), `sync_layers`. Straight from
  `HARNESS_ENGINE/blueprint/.harness-manifest.template.yml`, filled by the brief.
- `bundle.lock.json` — reproducibility pin: `{ forgeVersion, blueprintVersion, specHash, acpNode:
  {version,integrity}, chainId, contracts:{acp,erc6551Registry,erc8004} }`. Same iNFT + same
  blueprint ⇒ same bundle (§7.5).
- `crew/safety.md` + `crew/treasury.md` — the non-collapsible gates. Emitted verbatim from the
  blueprint (they are static; only `{{PLACEHOLDER}}` identity is substituted).
- `policy/owner-config.json` — the money boundary as data (see §1.4).
- `packages/shared/src/intents.ts` — the typed IPC: brain emits intents, never calls.
- `packages/worker/src/signer.ts` — the **stub with the boundary drawn** (see §1.4).
- `packages/safety/src/policy.ts` — the deterministic `ALLOW | DENY | ESCALATE` engine (see §1.4).

#### Key emitted contents (real, not pseudocode)

`package.json` (root):
```json
{
  "name": "<slug>",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20 <23" },
  "scripts": {
    "typecheck": "tsc -b",
    "test": "pnpm -r test",
    "dry-run": "HARNESS_MODE=dry_run bash scripts/dry-run.sh",
    "validate": "bash scripts/validate.sh"
  },
  "license": "MIT"
}
```

`.env.example` (never a real value — CI gitleaks enforces):
```bash
# ── Reasoning (brain) — BYO key, funds inference out-of-band, NOT from escrow ──
ANTHROPIC_API_KEY=          # sk-ant-...   (or VIRTUALS_COMPUTE_* as 402 fallback)
BRAIN_MODEL=claude-opus-4-8

# ── ACP worker (deterministic) ──
ACP_CONFIG_DIR=./.acp       # per-agent isolated config dir
ACP_CHAIN_ID=8453           # Base
ACP_NODE_VERSION=<pinned>   # never auto-update (see bundle.lock.json)

# ── Signer — provisioned on the DROPLET, never here. Dry-run needs NO key. ──
SIGNER_KMS_KEY_ID=          # KMS/MPC handle only — never a raw private key
HARNESS_MODE=dry_run        # dry_run → would-sign receipts, no funds move
```

`packages/shared/src/intents.ts`:
```ts
// The only thing that crosses the brain → worker boundary. No free-form calls.
export type Chain = 8453 | 42161; // Base | Arbitrum (allowlist)

export interface EconomicIntent {
  kind: "accept_job" | "submit_deliverable" | "escrow" | "settle" | "swap" | "fund_inference";
  jobId?: string;
  amount?: { value: string; token: "USDC" | "ETH"; decimals: number }; // typed, never a bare number
  counterparty?: `0x${string}`;   // checksummed; validated against allowlist downstream
  chain: Chain;
  offeringId?: string;            // ACP requires this embedded or budget defaults to $0.25
  idempotencyKey: string;         // a mid-loop kill never double-spends
  memo?: string;                  // data, never instructions
}

export type Verdict =
  | { decision: "ALLOW"; policyDigest: `0x${string}` }
  | { decision: "DENY"; rule: string }
  | { decision: "ESCALATE"; reason: string };
```

`packages/safety/src/policy.ts` (deterministic — the veto the brain cannot reach):
```ts
import type { EconomicIntent, Verdict } from "@<slug>/shared";
import owner from "../../../policy/owner-config.json";

// Pure function. No network, no LLM, no side effects. Same input ⇒ same verdict.
export function evaluate(intent: EconomicIntent): Verdict {
  const caps = owner.caps;               // { perTxUsd, perDayUsd, lifetimeUsd }
  const allow = new Set(owner.allowlist.map((a: string) => a.toLowerCase()));
  const chains = new Set<number>(owner.chains);

  if (!chains.has(intent.chain)) return { decision: "DENY", rule: "chain-not-allowed" };
  if (intent.counterparty && !allow.has(intent.counterparty.toLowerCase()))
    return { decision: "DENY", rule: "recipient-not-allowlisted" }; // never route by ticker
  const usd = toUsd(intent.amount);
  if (usd > caps.perTxUsd) return { decision: "DENY", rule: "per-tx-cap" };
  if (usd >= owner.ownerGateUsd) return { decision: "ESCALATE", reason: "owner-gate-threshold" };
  // per-day / lifetime / velocity read the durable ledger in the worker before ALLOW.
  return { decision: "ALLOW", policyDigest: owner.policyDigest };
}
```

`packages/worker/src/signer.ts` (**the boundary, drawn**):
```ts
import type { EconomicIntent, Verdict } from "@<slug>/shared";

/**
 * SIGNING BOUNDARY — read HARNESS_ENGINE §4.2 / §6.2 before editing.
 *
 * NO LLM MAY REACH THIS FILE. The brain emits EconomicIntent; the Safety engine
 * returns a Verdict; only an ALLOW (verified by policyDigest) may reach sign().
 * In dry_run this returns a "would-sign" receipt and moves nothing.
 *
 * Provision a capped, EXPIRING session key via KMS/MPC on the droplet. Never a
 * raw private key. Never in .env committed. The treasury key stays in custody.
 */
export async function sign(intent: EconomicIntent, verdict: Verdict): Promise<{ txHash?: string; dryRun: boolean }> {
  if (verdict.decision !== "ALLOW") throw new Error("refuse: non-ALLOW verdict reached signer");
  if (process.env.HARNESS_MODE !== "live") {
    return { dryRun: true }; // would-sign; audit record emitted upstream
  }
  // TODO(owner, on droplet): KMS/MPC session-key signTypedData → broadcast on Base.
  // Re-check caps against the session key's own on-chain limits here (INV-3).
  throw new Error("live signer not provisioned — implement KMS/MPC on the host");
}
```

`.github/workflows/ci.yml` (Safety Gate A as CI):
```yaml
name: harness-ci
on: [push, pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm i --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm -r test
      - name: gitleaks (no secrets in repo)
        uses: gitleaks/gitleaks-action@v2
      - name: Safety Gate A — no key material, policy signed, acp pinned
        run: bash scripts/validate.sh
```

`LICENSE` — MIT, year + `<owner handle / wallet>`. `.gitignore` — standard node + `.env`,
`*.key`, `.acp/`, `.harness-backup/`, `dist/`.

### 1.4 The money boundary, preserved as generated code

Even though the app runs none of it, the *emitted* repo must ship the invariants so the user's
droplet is safe by default:

- `policy/owner-config.json` is **required and non-empty** — the generator refuses to build without
  `caps.perTxUsd`, `allowlist[]`, `chains[]`, `ownerGateUsd`. This is INV-3/INV-4 as a build gate.
- `HARNESS_MODE=dry_run` is the committed default; `live` requires a provisioned KMS signer that the
  scaffold deliberately leaves unimplemented (throws).
- The LLM flesh-out (§1.5) is whitelisted to `packages/brain/**` and `crew/*.md` **only**. It can
  never write `policy/`, `packages/safety/`, or `packages/worker/signer.ts`. Those are deterministic
  and template-fixed — the exact separation from `HARNESS_ENGINE §6.2` rendered as a file-write ACL.

### 1.5 `web/src/forge/harness.ts` — module proposal

```ts
// In-browser Harness compiler: brief → content-addressed monorepo bundle.
// It COMPILES; it never runs an agent, holds a key, or signs. The emitted repo
// is the terminal handoff (the daemon runs on the owner's droplet).

import type { SoulConfig } from "../soul";
import { uploadData, type UploadOut } from "../irys";
import { GATEWAY, type Tag } from "../config";
import { streamChat, type ChatMessage } from "../llm";

export type TargetRuntime = "acp" | "game" | "okx" | "generic";

export interface SpendCaps { perTxUsd: number; perDayUsd: number; lifetimeUsd: number; ownerGateUsd: number; }

export interface HarnessBrief {
  agentName: string;                 // display name
  slug: string;                      // kebab-case (derived, validated)
  soul: SoulConfig;                  // reused from the wizard — the genome
  baseSoul: "iCLONE" | "VEGETA" | "GOKU" | "custom";
  runtime: TargetRuntime;            // default "acp"
  offerings: { name: string; priceUsd: number; description: string }[];
  pricingModel: string;
  caps: SpendCaps;
  allowlist: `0x${string}`[];        // recipient/contract allowlist (checksummed)
  chains: number[];                  // e.g. [8453]
  ownerWallet: `0x${string}` | "";   // ownerOf(tokenId); "" in dry-run
  tokenId?: string;                  // "" / undefined → "dry-run"
  agentId?: string;                  // ERC-8004 id if known
}

export interface BundleFile { path: string; text: string; }         // all text; binary N/A here
export interface Bundle { files: BundleFile[]; specHash: string; slug: string; }

// (a) collect — build a validated brief from the wizard soul + form inputs.
export function briefFromSoul(soul: SoulConfig, form: Partial<HarnessBrief>): HarnessBrief { /* … */ }

// (b) compile — PURE function: brief → deterministic file set + specHash.
//     No network, no randomness, canonical JSON, lexicographic file order.
export async function buildBundle(brief: HarnessBrief): Promise<Bundle> { /* render templates */ }

// (b1) deliver as a download — store-only ZIP, no new dependency (see note).
export function bundleToZip(bundle: Bundle): Blob { /* minimal STORE zip encoder */ }

// (b2) deliver as Irys-sealed files — permanent, gateway-served, like manifest.ts.
export async function sealBundle(irys: any, bundle: Bundle): Promise<{ baseURI: string; id: string }> {
  const paths: Record<string, { id: string }> = {};
  for (const f of bundle.files) {
    const up: UploadOut = await uploadData(
      irys, new TextEncoder().encode(f.text), "text/plain",
      [{ name: "App-Name", value: "iIrys Frame" }, { name: "Type", value: "harness-file" },
       { name: "Harness", value: bundle.slug }, { name: "Path", value: f.path }] as Tag[],
    );
    paths[f.path] = { id: up.id };
  }
  const manifest = { manifest: "arweave/paths", version: "0.1.0", paths };
  const man = await uploadData(irys, new TextEncoder().encode(JSON.stringify(manifest)),
    "application/x.arweave-manifest+json",
    [{ name: "App-Name", value: "iIrys Frame" }, { name: "Type", value: "harness-bundle" },
     { name: "Harness", value: bundle.slug }] as Tag[]);
  return { id: man.id, baseURI: `${GATEWAY}/${man.id}/` };
}

// (c) optional LLM flesh-out — user's own key via llm.ts. WHITELISTED PATHS ONLY.
const FLESHABLE = /^(packages\/brain\/|crew\/)/;   // never policy/, safety/, worker/signer.ts
export async function fleshOut(
  bundle: Bundle, brief: HarnessBrief,
  opts: { providerId: string; model: string; onText?: (d: string) => void },
): Promise<Bundle> {
  const files = await Promise.all(bundle.files.map(async (f) => {
    if (!FLESHABLE.test(f.path)) return f;          // ← the security ACL, in code
    const system = "You flesh out the reasoning/orchestration and role prose of an AI agent scaffold. " +
      "You NEVER write signing, policy, or key code. Preserve typed-intent boundaries.";
    const history: ChatMessage[] = [{ role: "user", content: fleshPrompt(f, brief) }];
    const text = await streamChat({ providerId: opts.providerId, model: opts.model, system, history,
      onText: opts.onText ?? (() => {}) });
    return { ...f, text };
  }));
  return { ...bundle, files };
}
```

**In-browser vs terminal handoff — the explicit split:**

- **In-browser (this module):** collect the brief, compile the bundle (pure), optionally LLM-flesh
  the brain, and deliver — either a **ZIP download** or an **Irys-sealed** set (permanent, the mint
  links outlive any server, consistent with the app's whole ethos). The app also renders the exact
  publish + run commands as copyable text.
- **Terminal (the user, off-app):** `git init && gh repo create <slug> --private --source . --push`,
  then on the droplet `pnpm i && pnpm dry-run` → provision KMS → `HARNESS_MODE=live pnpm start`. The
  app *shows* these; it never runs them and never sees a key.

**ZIP note:** to avoid a new runtime dependency, `bundleToZip` implements a ~40-line STORE-only
(uncompressed) ZIP encoder (local file headers + central directory + EOCD, CRC-32). If a dep is
acceptable, `fflate` (MIT, ~8KB) is the clean choice. Irys-seal is the preferred delivery — it fits
the app's permanence model and needs no encoder.

---

## Part 2 — Developer-support royalty (the money feature)

**Requirement (translated):** the creator chooses whether to support the developer with a **1%–5%**
fee, and whether it is a **perpetual royalty** (every secondary trade, forever) **or only on the
first purchase**. The developer wallet is **embedded in the contract**. The creator can also choose
**not** to support (no fee). **The fee only leaves when the iNFT is traded.**

### 2.1 Architecture decision — weigh (a)/(b)/(c), then recommend

The hard constraint is **ERC-2981**: `royaltyInfo(tokenId, salePrice)` returns **one** `(receiver,
amount)`. OpenSea (and every compliant marketplace) sends the entire secondary royalty to that
single receiver. You cannot express "split creator/dev" in ERC-2981 itself — you either point the
receiver at a splitter, or trust an EOA to forward (not enforceable).

| Option | What it is | Verdict |
|---|---|---|
| **(a) Immutable royalty-splitter as the ERC-2981 receiver** | For the perpetual case: a minimal 2-payee pull splitter receives the whole secondary royalty and lets creator/dev each pull their bps share. | ✅ **Required** for the perpetual split — the only trustless, marketplace-compatible way. |
| **(b) Split primary mint revenue at withdrawal** | For the first-sale case: dev's cut accrues from each paid mint inside `CloneForge`; dev pulls it. Secondary royalty stays 100% creator. | ✅ **Correct** for first-sale — no splitter needed; the "trade" is the mint. |
| **(c) Fold everything into CloneForge** | Put all accounting + mode + the split logic in one contract. | ⚠️ Partial — fold the *accounting and mode*, but the perpetual split **must** be its own receiver contract (see (a)); CloneForge can't be its own ERC-2981 receiver and also the collection. |

**Recommendation — the hybrid:** fold **mode + first-sale accrual + withdrawal** into `CloneForge`,
and for the **perpetual** case have `CloneForge`'s constructor **deploy one immutable
`FrameRoyaltySplit`** and set it as the ERC-2981 default receiver. Why this wins on every axis:

- **Marketplace compatibility:** a single ERC-2981 receiver (the splitter) — OpenSea honors it as-is.
- **Gas / UX:** the splitter's bytecode is embedded in `CloneForge`'s creation code (`new
  FrameRoyaltySplit(...)`), so it deploys in the **same one transaction** the app already sends. No
  second wallet signature; `deploy.ts` needs no second artifact.
- **Auditability:** the splitter is tiny, immutable, no owner, no upgrade — a reviewer reads it in a
  minute. First-sale accrual is a two-line addition guarded by mode.
- **Pull-payment safety:** **no push to an arbitrary address in the mint path.** Mints only
  *accrue* to a counter; the developer (first-sale) and creator/dev (perpetual) **pull** their funds.
  This eliminates the reentrancy-via-push and the gas-griefing-on-mint vectors. `nonReentrant` stays
  on `mint`/`mintDrop`/`withdraw`; the splitter uses checks-effects-interactions + `Address.sendValue`.

**Fee semantics locked (must be shown verbatim in the UX):**

- **None:** ERC-2981 receiver = creator; `royaltyBps` = creator's chosen royalty. Dev absent.
- **First-sale:** ERC-2981 receiver = creator (secondary unchanged, 100% creator). Dev accrues
  `devBps` of each **paid** mint's `msg.value`; pulls via `withdrawDev()`. Free owner/minter mints
  accrue nothing — "the fee only leaves when the iNFT is traded" (a real primary sale).
- **Perpetual:** ERC-2981 total royalty = `royaltyBps + devBps`, receiver = the `FrameRoyaltySplit`.
  Secondary royalties flow to the splitter; creator and dev pull their bps share, forever. Primary
  mint revenue in this mode goes 100% to the creator (perpetual ≠ first-sale; it's an either/or).

The dev fee is **additive** (a separate 1–5% on top of the creator's royalty), capped so
`royaltyBps + devBps ≤ 1000` (10%) in perpetual mode, keeping the secondary market sane. This is the
honest reading of "support the developer with a 1–5% fee" and keeps the creator's own royalty intact.

### 2.2 New contract — `contracts/src/FrameRoyaltySplit.sol`

Pattern source: OpenZeppelin `PaymentSplitter` (`@openzeppelin/contracts/finance/PaymentSplitter.sol`)
proportional-pull algorithm, reduced to two **immutable** payees and hardened (no ERC-20 surface, no
owner, no setters). Uses `@openzeppelin/contracts/utils/Address.sol`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title  FrameRoyaltySplit
 * @notice Immutable two-payee ETH splitter used as the ERC-2981 receiver when a
 *         collection opts into PERPETUAL developer support. Marketplaces send the
 *         whole secondary royalty here; creator and developer each PULL their
 *         proportional bps share. No owner, no setters, no upgrade path.
 * @dev    OZ PaymentSplitter's proportional-release math, two fixed payees.
 *         Pull-only; checks-effects-interactions; reentrancy-safe by construction.
 */
contract FrameRoyaltySplit {
    using Address for address payable;

    address public immutable creator;
    address public immutable developer;
    uint96  public immutable creatorBps; // of sale price
    uint96  public immutable devBps;     // of sale price (100..500 = 1%..5%)

    uint256 public totalReleased;
    mapping(address => uint256) public released;

    event PaymentReceived(address indexed from, uint256 amount);
    event PaymentReleased(address indexed to, uint256 amount);

    error NotAPayee();
    error NothingDue();
    error ZeroAddress();
    error BadShares();

    constructor(address creator_, address developer_, uint96 creatorBps_, uint96 devBps_) {
        if (creator_ == address(0) || developer_ == address(0)) revert ZeroAddress();
        if (creatorBps_ == 0 || devBps_ == 0) revert BadShares();
        creator = creator_;
        developer = developer_;
        creatorBps = creatorBps_;
        devBps = devBps_;
    }

    receive() external payable {
        emit PaymentReceived(msg.sender, msg.value);
    }

    function _shareOf(address account) internal view returns (uint96) {
        if (account == creator) return creatorBps;
        if (account == developer) return devBps;
        return 0;
    }

    function pending(address account) public view returns (uint256) {
        uint96 share = _shareOf(account);
        if (share == 0) return 0;
        uint256 totalReceived = address(this).balance + totalReleased;
        return (totalReceived * share) / (uint256(creatorBps) + devBps) - released[account];
    }

    /// Anyone may trigger a release; funds only ever go to creator or developer.
    function release(address payable account) external {
        uint96 share = _shareOf(account);
        if (share == 0) revert NotAPayee();
        uint256 due = pending(account);
        if (due == 0) revert NothingDue();
        released[account] += due;   // effects
        totalReleased += due;
        emit PaymentReleased(account, due);
        account.sendValue(due);     // interaction
    }
}
```

### 2.3 `CloneForge.sol` diffs

All additions are backward-compatible; existing tests keep passing when mode = `None`.

**Imports** — add `Address`:
```solidity
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {FrameRoyaltySplit} from "./FrameRoyaltySplit.sol";
```

**Enum + bounds constants** (near the top of the contract):
```solidity
enum SupportMode { None, FirstSale, Perpetual } // 0, 1, 2

uint96 private constant DEV_BPS_MIN = 100;         // 1%
uint96 private constant DEV_BPS_MAX = 500;         // 5%
uint96 private constant MAX_TOTAL_ROYALTY_BPS = 1000; // creator + dev ≤ 10% (perpetual)
```

**Config struct** — three new fields (append, so ABI ordering stays readable):
```solidity
struct Config {
    // …existing fields…
    address developer;      // dev wallet (deploy arg; UI defaults it to Alex's dev wallet)
    uint96  devBps;         // 0, or 100..500
    SupportMode supportMode;
}
```

**State** (public → free getters for the app):
```solidity
address public developer;
uint96  public devBps;
SupportMode public supportMode;
address public royaltySplit;   // FrameRoyaltySplit when Perpetual, else address(0)
uint256 public devAccrued;     // FirstSale: dev's pull-able cut of primary revenue
```

**Events / errors** (add):
```solidity
event DevWithdrawn(address indexed developer, uint256 amount);
event SupportConfigured(SupportMode mode, address developer, uint96 devBps, address split);
error BadDevConfig();
error RoyaltyTooHigh();
error RoyaltyLocked();
```

**Constructor** — replace the single `_setDefaultRoyalty(...)` line (currently line 111) with:
```solidity
supportMode = c.supportMode;
if (c.supportMode == SupportMode.None) {
    if (c.devBps != 0) revert BadDevConfig();
    _setDefaultRoyalty(c.royaltyReceiver, c.royaltyBps);           // creator only
} else {
    if (c.developer == address(0)) revert ZeroAddress();
    if (c.devBps < DEV_BPS_MIN || c.devBps > DEV_BPS_MAX) revert BadDevConfig();
    developer = c.developer;
    devBps = c.devBps;
    if (c.supportMode == SupportMode.FirstSale) {
        _setDefaultRoyalty(c.royaltyReceiver, c.royaltyBps);        // secondary = creator only
    } else { // Perpetual
        if (uint256(c.royaltyBps) + c.devBps > MAX_TOTAL_ROYALTY_BPS) revert RoyaltyTooHigh();
        FrameRoyaltySplit split = new FrameRoyaltySplit(c.royaltyReceiver, c.developer, c.royaltyBps, c.devBps);
        royaltySplit = address(split);
        _setDefaultRoyalty(address(split), uint96(uint256(c.royaltyBps) + c.devBps));
    }
    emit SupportConfigured(c.supportMode, developer, devBps, royaltySplit);
}
```
(Keep the existing `if (c.owner == address(0) || c.royaltyReceiver == address(0)) revert ZeroAddress();`.)

**First-sale accrual** — in `mint(...)`, after the payment check and before `_mint`:
```solidity
if (!privileged && supportMode == SupportMode.FirstSale && msg.value != 0) {
    devAccrued += (msg.value * devBps) / 10_000;
}
```
Same three lines in `mintDrop(...)` (there `msg.value == mintPrice * quantity`). Privileged mints are
free (`msg.value == 0`) so they never accrue — exactly "the fee only leaves when the iNFT is traded."

**Withdrawal** — reserve the dev cut, add a pull for the dev:
```solidity
function withdraw(address payable to) external onlyOwner nonReentrant {
    if (to == address(0)) revert ZeroAddress();
    uint256 ownerShare = address(this).balance - devAccrued;  // dev's accrued cut is reserved
    if (ownerShare == 0) revert NoBalance();
    Address.sendValue(to, ownerShare);
    emit Withdrawn(to, ownerShare);
}

/// Dev pulls its accrued first-sale support cut. Pull pattern: nothing is ever
/// pushed to the developer in the mint path; the developer (or anyone) triggers it.
function withdrawDev() external nonReentrant {
    uint256 amount = devAccrued;
    if (amount == 0) revert NoBalance();
    devAccrued = 0;                                   // effects
    Address.sendValue(payable(developer), amount);    // interaction
    emit DevWithdrawn(developer, amount);
}
```

**Lock perpetual royalty** — guard the existing `setDefaultRoyalty` setter so a perpetual commitment
can't be silently re-pointed away from the dev:
```solidity
function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
    if (supportMode == SupportMode.Perpetual) revert RoyaltyLocked(); // commitment is immutable
    if (receiver == address(0)) revert ZeroAddress();
    _setDefaultRoyalty(receiver, bps);
}
```
(Design note: this makes "perpetual, forever" a real on-chain guarantee. Alternative — allow changes
but enforce a dev-bps floor — is weaker; recommend the lock. Already-accrued splitter funds are
always claimable regardless.)

**Developer default (deploy arg).** In `contracts/script/Deploy.s.sol` and `web/src/forge/deploy.ts`,
the developer defaults to Alex's dev wallet but is overridable:
```solidity
// Deploy.s.sol
address constant DEFAULT_DEVELOPER = 0x0000000000000000000000000000000000000000; // TODO: Alex's dev wallet
address developer = vm.envOr("DEVELOPER", DEFAULT_DEVELOPER);
```

### 2.4 `web/src/forge/deploy.ts` + `forgeStore.ts` diffs

`forgeStore.ts` — extend `DropConfig`:
```ts
export interface DropConfig {
  // …existing…
  devSupportMode: "none" | "first" | "perpetual"; // default "none"
  devBps: number;                                  // 0, or 100..500 (UI: 1..5%)
}
// DEFAULT_DROP: add  devSupportMode: "none", devBps: 0,
```

`deploy.ts` — add the dev wallet constant + map into the Config struct:
```ts
// Alex's developer wallet — receives the optional support fee. Deploy-arg overridable.
export const DEV_WALLET = "0xTODO_ALEX_DEV_WALLET"; // set to the real dev wallet before ship

const SUPPORT_MODE = { none: 0, first: 1, perpetual: 2 } as const;

function toConfigStruct(owner: string, p: ForgeDeployParams) {
  const mode = p.drop.devSupportMode ?? "none";
  const devBps = mode === "none" ? 0 : Math.max(100, Math.min(500, Math.round(p.drop.devBps || 0)));
  return {
    // …existing fields…
    developer: mode === "none" ? ethers.ZeroAddress : DEV_WALLET,
    devBps: BigInt(devBps),
    supportMode: SUPPORT_MODE[mode],
  };
}
```
The single precompiled `CloneForgeArtifact.json` (recompiled with Foundry) already contains the
embedded `FrameRoyaltySplit` bytecode — **still one deploy transaction, no second artifact.**

### 2.5 Foundry test list — `contracts/test/{CloneForge,FrameRoyaltySplit}.t.sol`

Every existing test must still pass (they use `SupportMode.None` / `devBps 0`). Add:

**CloneForge — mode & config**
1. `test_ModeNone_NoDevFields` — devBps 0, developer ignored; royaltyInfo receiver = creator.
2. `test_ModeNone_RejectsNonZeroDevBps` — `devBps != 0` with `None` ⇒ `BadDevConfig`.
3. `test_DevBps_BoundsLow` — mode set, `devBps = 99` ⇒ `BadDevConfig` (min 100).
4. `test_DevBps_BoundsHigh` — `devBps = 501` ⇒ `BadDevConfig` (max 500).
5. `test_Support_ZeroDeveloperReverts` — mode ≠ None with `developer = 0` ⇒ `ZeroAddress`.

**First-sale split**
6. `test_FirstSale_AccruesOnPaidMint` — paid `mintDrop`/`mint`: `devAccrued == msg.value*devBps/1e4`.
7. `test_FirstSale_FreeMintNoAccrual` — owner/minter free mint ⇒ `devAccrued` unchanged.
8. `test_FirstSale_WithdrawReservesDevCut` — `withdraw` pays owner `balance - devAccrued`; dev cut stays.
9. `test_FirstSale_WithdrawDevPaysDeveloper` — `withdrawDev()` transfers `devAccrued` to `developer`, zeroes it.
10. `test_FirstSale_WithdrawDevTwiceReverts` — second `withdrawDev` ⇒ `NoBalance`.
11. `test_FirstSale_SecondaryRoyaltyUnchanged` — `royaltyInfo` receiver = creator, amount = `royaltyBps`.

**Perpetual split**
12. `test_Perpetual_DeploysSplitter` — `royaltySplit != address(0)`; `royaltyInfo` receiver = splitter.
13. `test_Perpetual_TotalRoyaltyIsSum` — `royaltyInfo(_, 10_000) == royaltyBps + devBps`.
14. `test_Perpetual_RejectsRoyaltyTooHigh` — `royaltyBps + devBps > 1000` ⇒ `RoyaltyTooHigh`.
15. `test_Perpetual_RoyaltyLocked` — `setDefaultRoyalty` ⇒ `RoyaltyLocked`.
16. `test_Perpetual_PrimaryRevenueAllOwner` — paid mints: `devAccrued == 0`; `withdraw` pays full balance.

**FrameRoyaltySplit (unit)**
17. `test_Split_ProportionalRelease` — fund with 1 ETH; creator pulls `creatorBps/(sum)`, dev pulls `devBps/(sum)`; sum == 1 ETH (± dust).
18. `test_Split_ReleaseTwiceNothingDue` — second `release` with no new funds ⇒ `NothingDue`.
19. `test_Split_IncrementalReceives` — release, receive more, release again → correct cumulative math.
20. `test_Split_NonPayeeReverts` — `release(stranger)` ⇒ `NotAPayee`.
21. `test_Split_ConstructorZeroAddr` / `test_Split_ConstructorZeroShares` — `ZeroAddress` / `BadShares`.

**Cross-cutting security**
22. `test_Reentrancy_WithdrawDev` — malicious `developer` re-entering `withdrawDev` gains nothing (state zeroed pre-send; `nonReentrant`).
23. `test_OnlyOwner_Withdraw` — stranger `withdraw` ⇒ `OwnableUnauthorizedAccount`.
24. `test_WithdrawDev_AnyoneCanTrigger_FundsGoToDev` — stranger calls `withdrawDev`; ETH lands at `developer` (pull pattern is caller-agnostic).
25. `test_RoyaltyInfo_Invariance` (fuzz) — for random `salePrice`, `royaltyInfo` amount == `salePrice * total / 10_000`, no overflow.
26. `test_SupportsInterface_2981_4906_Unchanged` — regression on `supportsInterface`.

Fuzz `devBps ∈ [100,500]` and `salePrice` where relevant.

### 2.6 Create-wizard UX (`StepContract` in `web/src/components/Create.tsx`)

Placement: **directly under the existing "Royalty (%)" field**, before the Supply section — royalty
and dev-support are the two "who gets paid" controls and belong together. New block:

- A three-way segmented control (reusing the existing `.doc-switch` style): **No fee · First
  purchase · Perpetual**. Default **No fee**.
- When a fee mode is active: a **1–5% slider** (`min=1 max=5 step=1`, mapped to `devBps = value*100`).
- A one-line plain-language explainer that changes with the choice.
- Show the developer wallet (shortened) as read-only, so it's transparent that the fee is embedded.

```tsx
{/* ── Support the developer (optional) ─────────────────────────── */}
<span className="wizard__sub">Support the developer <em>(optional)</em></span>
<div className="doc-switch">
  <button className={drop.devSupportMode === "none" ? "is-active" : ""}
          onClick={() => patchDrop({ devSupportMode: "none", devBps: 0 })}>No fee</button>
  <button className={drop.devSupportMode === "first" ? "is-active" : ""}
          onClick={() => patchDrop({ devSupportMode: "first", devBps: drop.devBps || 300 })}>First purchase</button>
  <button className={drop.devSupportMode === "perpetual" ? "is-active" : ""}
          onClick={() => patchDrop({ devSupportMode: "perpetual", devBps: drop.devBps || 300 })}>Perpetual</button>
</div>
{drop.devSupportMode !== "none" && (
  <div className="field">
    <label>Developer fee · {(drop.devBps / 100).toFixed(0)}%</label>
    <input type="range" min={1} max={5} step={1}
           value={Math.round(drop.devBps / 100) || 1}
           onChange={(e) => patchDrop({ devBps: Number(e.target.value) * 100 })} />
  </div>
)}
<p className="folder-legend">
  {drop.devSupportMode === "none"
    ? "No developer fee. You keep 100% of mint revenue and your full royalty."
    : drop.devSupportMode === "first"
      ? `A ${(drop.devBps / 100).toFixed(0)}% cut of each first sale (mint) goes to the developer who built this tool. Your secondary royalty (${(drop.royaltyBps / 100).toFixed(1)}%) is untouched. The fee only moves when someone actually mints — nothing on free mints.`
      : `The developer receives ${(drop.devBps / 100).toFixed(0)}% of every secondary sale, forever, on top of your ${(drop.royaltyBps / 100).toFixed(1)}% royalty (total ${((drop.royaltyBps + drop.devBps) / 100).toFixed(1)}% sent to a small, immutable splitter that pays you both automatically). Nothing on the first mint. This is a permanent, on-chain commitment.`}
</p>
```

Also thread the two new fields through `deploy()` / `estimateNow()` in `StepContract` (they already
spread `...drop`, so `devSupportMode` + `devBps` ride along once added to `DropConfig`), and echo the
choice into the deploy `confirmDialog` copy (e.g. `", dev support 3% perpetual"`). In `Launch.tsx`,
optionally surface a "Developer support" stat and, for first-sale, a "Developer can withdraw
{devAccrued}" line reading `devAccrued`/`supportMode` from an extended `readContractState`.

**Plain-language principle (show, don't bury):** the creator must always see (1) that a fee is
optional and off by default, (2) exactly who gets paid and how much, (3) that perpetual is a
permanent commitment, and (4) that nothing leaves until a real trade — mirroring the contract's
"fee only leaves when the iNFT is traded."

---

## OpenZeppelin / library provenance (audited patterns used)

- `@openzeppelin/contracts/finance/PaymentSplitter.sol` — the proportional pull-release algorithm
  `FrameRoyaltySplit` is reduced from (two immutable payees, ETH-only, no owner).
- `@openzeppelin/contracts/utils/Address.sol` — `sendValue` for all ETH transfers (bubble-revert,
  fixed-gas-safe vs raw `.call` idioms).
- `@openzeppelin/contracts/token/common/ERC2981.sol` — `_setDefaultRoyalty`, single-receiver
  `royaltyInfo`; the constraint that forces the splitter for the perpetual split.
- `@openzeppelin/contracts/utils/ReentrancyGuard.sol` — already on `mint`/`mintDrop`/`withdraw`;
  extended to `withdrawDev`.
- `@openzeppelin/contracts/access/{Ownable,Ownable2Step}.sol` — owner-gated setters/withdraw.
- `@openzeppelin/contracts/utils/Pausable.sol` — unchanged.
- `erc721a/contracts/ERC721A.sol` (Chiru Labs) — unchanged token core.

Solc `0.8.28`, optimizer 200, EVM `cancun` (per `contracts/foundry.toml`) — no change.

## Security posture summary

- **No push payments in the mint path** — mints only *accrue*; creator and developer *pull*. Removes
  reentrancy-via-push and gas-griefing-on-mint entirely.
- **Perpetual = one immutable, owner-less splitter** as the sole ERC-2981 receiver — trustless,
  marketplace-native, un-re-pointable (royalty locked in perpetual mode).
- **Browser never signs an agent action, never holds an agent key** — the Harness feature emits a
  repo whose signer is a deliberately-unimplemented stub; `HARNESS_MODE=dry_run` default; the LLM
  flesh-out is ACL'd away from `policy/`, `safety/`, and `signer.ts`.
- **Secrets never in artifacts** — `.env.example` placeholders only; `gitleaks` in the emitted CI.
- Every new external function is `onlyOwner` (setters/withdraw) or pull-safe (`withdrawDev`,
  `release`), and the full Foundry list above gates the change.
