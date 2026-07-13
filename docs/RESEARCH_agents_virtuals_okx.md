# RESEARCH — Agent creation + NFT↔agent linking for iIrys Frame

> Integration spec for adding **optional agent creation** and **NFT→agent binding** to iIrys Frame
> (CLONE FRAME / iCLONE). Concrete, implementable. Every fact is either cited to a fetched page,
> pulled from the live npm registry / on-chain source, or mined from the user's own production
> troubleshooting repo `devclone20/troubleshooting-acp-agentes-virtual`.
>
> **Verified 2026-07-08.** Where a fact could not be verified it is marked **⚠️ UNVERIFIED**.
> Chain is **Base, chainId 8453** throughout. User signs every transaction with their own Privy
> wallet; LLM keys are BYO in `localStorage` (never written into generated files).

---

## 0. TL;DR — the shape of the feature

Two optional tracks, added **after** the existing wizard `seal` step (i.e. after an iNFT is minted):

- **Track A · Bind on-chain (fully in-browser, user signs):** create the NFT's **ERC-6551
  token-bound account** (its agent wallet/vault), and optionally register the NFT's soul as an
  **ERC-8004** on-chain identity and point that identity's `agentWallet` at the TBA via ERC-1271.
  100% doable in-app with `ethers` + Privy — same pattern as `deploy.ts` / `mint.ts`.

- **Track B · Generate the agent + monorepo (in-app generate → terminal handoff):** use the BYO
  LLM (`llm.ts`) to expand the Neural Soul into a runnable **Virtuals GAME/ACP agent monorepo**
  (TypeScript), emit `offerings.json` (both schemas), `.env.example` (placeholders only), and a
  copy-paste **`acp-cli` command block**. The app **cannot** create the Virtuals agent itself —
  that needs a Node CLI, a browser-OAuth login, a hardware-bound P256 signer, and a persistent
  daemon. iIrys prepares everything; the user runs it in a terminal and (optionally) publishes to
  GitHub / operates on **OKX.ai** via `os.virtuals.io`.

The honest boundary: **the strong cryptographic marriage of an NFT to an agent is ERC-6551 +
ERC-8004, and that is in-browser. The Virtuals/OKX economic agent is a *separate* identity linked
*by convention* (its card/soul references the `tokenURI`), and it is created in a terminal.**

---

## 1. Virtuals agent creation — exact flow

### 1.1 Packages & versions (live npm registry, 2026-07-08)

| Package | Version | Role |
|---|---|---|
| `@virtuals-protocol/acp-cli` | **1.0.24** | Terminal agent lifecycle (configure, create, add-signer, wallet, offering, job). This is what the user's prod estate runs. |
| `@virtuals-protocol/game` | **0.1.14** | **GAME SDK** — build the agent's brain in code (`GameAgent`/`GameWorker`/`GameFunction`). |
| `@virtuals-protocol/acp-node` | **0.3.0-beta.40** | ACP SDK (v1, callback/phase model). |
| `@virtuals-protocol/acp-node-v2` | **0.1.7** | ACP SDK v2 — event-driven rewrite (`AcpAgent` + `JobSession`, LLM tool integration, multi-chain). Prefer for new builds. |
| `@virtuals-protocol/game-acp-plugin` | **0.2.9** | Wires ACP jobs into a GAME agent as functions. |
| `virtuals-acp` (PyPI) | pin explicitly | Python ACP SDK. Repo pinned `0.3.23` historically; **⚠️ verify current before pinning** — unpinned installs caught broken builds (repo doc 01). |

Install (TS path, recommended):
```bash
npm install -g @virtuals-protocol/acp-cli           # 1.0.24
# in the generated monorepo:
npm install @virtuals-protocol/game @virtuals-protocol/acp-node-v2 @virtuals-protocol/game-acp-plugin dotenv
```
> The npm package name has changed over time. If `-g` install fails, search the registry:
> `curl -s "https://registry.npmjs.org/-/v1/search?text=virtuals+acp&size=5"` (repo doc 01).

### 1.2 The `os.virtuals.io/quickstart` flow (fetched verbatim)

Source: <https://os.virtuals.io/quickstart> ("EconomyOS Agent Quickstart"). Prereqs: **Node ≥ 18**,
a browser for OAuth. **No env vars / API keys are required for the quickstart itself.**

```bash
npm install -g @virtuals-protocol/acp-cli     # 1. install

acp configure                                  # 2. one-time browser sign-in (Privy); tokens stored + auto-refreshed

acp agent create                               # 3. provisions an on-chain wallet + email inbox
acp agent add-signer                           #    adds a P256 signing key, browser-approved (required to sign on-chain)

acp agent whoami                               # 4. verify
acp wallet address --json

acp wallet topup --chain-id 8453 --method coinbase --amount 25   # 5. fund

acp trade --token-in usdc --chain-in 8453 --amount-in 50 \       # 6. first economic action
  --token-out virtual --chain-out 8453
```

The user's prod repo confirms the create step in fuller form (doc 01):
```bash
acp configure                                  # → opens browser URL; returns a request-id
acp configure complete --request-id <request-id>
acp agent create \
  --name "MeuAgente" --description "what it does" --image "https://..." \
  --signer --policy restricted                 # --signer starts signer registration; restricted = ACP-only blast radius
```

### 1.3 GAME SDK — the agent brain in code

Source: <https://github.com/game-by-virtuals/game-node> README. Install `@virtuals-protocol/game`
(0.1.14). Minimal runnable agent:

```typescript
import {
  GameFunction, ExecutableGameFunctionResponse, ExecutableGameFunctionStatus,
  GameWorker, GameAgent,
} from "@virtuals-protocol/game";

const myFunction = new GameFunction({
  name: "action_name",
  description: "Description of action",
  args: [] as const,
  executable: async (args) =>
    new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Done, "Success"),
});

const worker = new GameWorker({
  id: "worker_1", name: "Worker", description: "A worker",
  functions: [myFunction], getEnvironment: async () => ({}),
});

const agent = new GameAgent("your_api_key", {   // ← the GAME API key
  name: "Agent Name", goal: "Primary goal", description: "Description",
  getAgentState: async () => ({}), workers: [worker],
});

await agent.init();
await agent.run(60, { verbose: true });
```

- **GAME API key:** obtained in the **Game Console** (per the README). The exact env-var name is
  not stated in the fetched README — the community/starter convention is **`GAME_API_KEY`** (also
  seen as `VIRTUALS_API_KEY`). **⚠️ UNVERIFIED env-var name** — confirm against the `game-starter`
  project the README points to. Treat as a placeholder in `.env.example`.
- The GAME key is **separate** from the ACP identity: GAME = reasoning/agent-loop; ACP = the
  economic/on-chain signer. A commerce agent needs both.

### 1.4 Keys / env / where the agent lives

| Credential | Where it lives | Portable? | Notes |
|---|---|---|---|
| `config.json` (publicKey, agent id, walletId, builderCode) | `~/.config/acp-<agent>/acp/` | ✅ metadata | Isolate per-agent via **`ACP_CONFIG_DIR`**. |
| JWT tokens (owner mgmt only) | macOS Keychain `acp-auth` | ⚠️ via explicit migration | **Refresh tokens rotate on each use** — only one machine may hold them. |
| P256 signer (`signer-keys.json`) | `~/Library/Application Support/acp-cli/` (macOS Secure Enclave-wrapped) | ❌ **hardware-bound** | Cannot copy to Linux — register a **new** signer on each machine. |
| `GAME_API_KEY`, `ANTHROPIC_API_KEY` | `.env.local` (real), `.env` (placeholders) | ✅ copy carefully | See the 401 gotcha (§6). |

**Runtime auth is by P256 signature (EIP-712 `AgentAuth`), NOT bearer JWT** — the signer is
registered on-chain, so it **never expires** and the agent runs 24/7 (repo doc 00). JWTs only
matter for interactive owner operations (create agent, add-signer).

**Where the agent lives after creation:** an on-chain **ERC-4337 smart account** (the *agent
wallet*, e.g. iCLONE `0x44cc25…`) owned by an **owner wallet** (e.g. `0xb480…`), an ACP `agentId`
(UUID), an email inbox, and — for graduated agents — an auto-registered ERC-8004 identity. The code
runs wherever you deploy it (prod estate: DigitalOcean droplet, `systemd`, `ACP_CONFIG_DIR`
isolation).

---

## 2. NFT↔agent linking (the core of the feature)

There are **three** distinct "wallets/identities" in play. Do not conflate them:

| Thing | What it is | Created by | On-chain? |
|---|---|---|---|
| **ERC-6551 TBA** | A wallet **owned by the NFT itself** (`tokenId`'s account). Whoever holds the NFT controls it. | `CloneForge.createTokenAccount(tokenId)` | ✅ deterministic |
| **ERC-8004 identity** | An ERC-721 in the Identity Registry; `agentURI` = the agent card, `agentWallet` metadata = a wallet. The trust/reputation graph. | `IdentityRegistry.register(agentURI)` | ✅ |
| **Virtuals ACP agent** | An ERC-4337 smart account + ACP `agentId` + email, the *economic* actor on ACP/OKX. | `acp agent create` (terminal) | ✅ but **separate** |

**Key truth:** there is **no on-chain primitive that "marries" an arbitrary NFT to a Virtuals ACP
agent.** The cryptographic bind you *can* make in-app is **ERC-6551 (NFT owns a wallet) + ERC-8004
(identity points at that wallet)**. The Virtuals/OKX agent is linked to the NFT **by convention**:
its card/soul references the `tokenURI`, and the agent runtime boots its `system_prompt` from the
soul in that `tokenURI` — exactly the contract `soul.ts` already encodes (`ai_soul.system_prompt`,
`base_model`, `temperature`, `memory_anchor`). State this plainly in the UI; don't imply a stronger
link than exists.

### 2.1 ERC-6551 token-bound account — the NFT's agent wallet (IN-BROWSER)

`CloneForge.sol` already ships this. Addresses baked into `web/src/forge/deploy.ts`:

```
ERC-6551 Registry        0x000000006551c19487814612e58FE06813775758   (canonical, same on every chain)
Tokenbound Impl          0x41C8f39463A868d3A88af00cd0fe7102F30E44eC
salt = bytes32(0)   chainId = 8453   tokenContract = <your CloneForge>   tokenId = <minted id>
```

Concrete calls (both already on the deployed contract):
```solidity
function tokenAccount(uint256 tokenId) external view returns (address);   // predicted TBA (no tx)
function createTokenAccount(uint256 tokenId) external returns (address);   // deploys the TBA (1 tx, anyone can call)
```
In-app: read `tokenAccount(tokenId)` to show the address, then send one wallet tx to
`createTokenAccount(tokenId)`. This IS "linking the NFT to an agent wallet." Fund that TBA with
Base ETH/USDC and it is the agent's on-chain vault.

### 2.2 ERC-8004 identity registration (IN-BROWSER, optional)

Identity Registry on Base: **`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`** (this is the address in
the user's memory / iCLONE #55101 + VEGETA #58099 are registered here). Source of signatures:
`erc-8004/erc-8004-contracts` → `contracts/IdentityRegistryUpgradeable.sol` (fetched verbatim):

```solidity
struct MetadataEntry { string metadataKey; bytes metadataValue; }

event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue);

function register() external returns (uint256 agentId);
function register(string memory agentURI) external returns (uint256 agentId);
function register(string memory agentURI, MetadataEntry[] memory metadata) external returns (uint256 agentId);
function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory);
function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external;
function setAgentURI(uint256 agentId, string calldata newURI) external;
function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
```

- **`agentId` = the ERC-721 tokenId minted by the registry** (auto-incremented `_lastId`).
- **Register the NFT's soul:** `register(tokenURI)` where `tokenURI` is the Irys metadata link the
  wizard already produces (`sealed.metadata`). Now the CLONE FRAME NFT and the 8004 identity share
  a soul document.
- **Point the 8004 identity's wallet at the NFT's TBA — "agentWallet via 1271":**
  `setAgentWallet(agentId, tba, deadline, signature)`. The registry verifies `signature` over an
  EIP-712 digest (`AGENT_WALLET_SET_TYPEHASH` of `agentId, newWallet, owner, deadline`). It tries
  **ECDSA first**, then **ERC-1271** (`newWallet.isValidSignature(digest, signature)` must return
  the magic value). Because a Tokenbound account implements ERC-1271 by delegating to the NFT
  owner, the flow is: **the token owner signs the EIP-712 digest with their Privy wallet → pass it
  as `signature` with `newWallet = tba`** → the TBA's 1271 validates it. This is the exact
  "agentWallet via 1271" bind.
  **⚠️ Verify** the impl at `0x41C8f39…` returns `0x1626ba7e` for owner-signed digests; if not,
  fall back to `newWallet = owner EOA` (plain ECDSA path, always works).
- ERC-8004 is still an evolving EIP: **pull the ABI from the deployed contract**
  (`abis/IdentityRegistry.json` in the repo, or BaseScan) rather than hand-writing it, in case the
  live `0x8004A169…` deployment differs from `master`.

### 2.3 What runs where

| Action | In iIrys (browser, user signs) | Terminal (acp-cli) |
|---|---|---|
| `createTokenAccount(tokenId)` → TBA | ✅ | — |
| `register(tokenURI)` → 8004 agentId | ✅ | — (Virtuals auto-registers *graduated* ACP agents) |
| `setAgentWallet(agentId, tba, …)` (1271) | ✅ | — |
| `setMetadata` / `setAgentURI` | ✅ | — |
| Create the Virtuals **ACP** agent + signer | ❌ (needs Node + OAuth + keyring + P256) | ✅ `acp agent create` |
| Fund ACP agent wallet / topup | ❌ | ✅ `acp wallet topup` |
| Publish offerings | ❌ | ✅ `acp offering create` |
| Run the agent 24/7 | ❌ | ✅ systemd on a server |

---

## 3. OKX.ai path — publish/operate an agent

**Important honesty note:** the fetched `os.virtuals.io/quickstart` page **does not mention
"OKX.ai" or ACP publishing by name**. It is the generic **EconomyOS** onboarding (identity, funds,
trading, commerce). OKX.ai is a **marketplace surface that consumes the same ACP agent identity** —
so "publish to OKX.ai" = "create a funded ACP agent with a registered signer, then list its
offerings." The steps:

1. **Onboard the agent** (§1.2): `acp configure` → `acp agent create --signer --policy restricted`
   → `acp agent whoami`.
2. **Register the signer for autonomy** (repo doc 02):
   ```bash
   acp agent add-signer --agent-id <id> --policy restricted --no-wait --json
   # → approve the returned https://app.virtuals.io/... URL in the browser (as OWNER) within 5 min
   acp agent signer-status --agent-id <id> --request-id <rid> --public-key <pk> --json
   ```
   Then set **Transaction Mode** in the dashboard (`app.virtuals.io/os` → your agent → Wallet tab)
   to automatic, or some ops still prompt (repo doc 02 — the "second gate").
3. **Fund**: `acp wallet topup --chain-id 8453 --method coinbase --amount 25`.
4. **Publish offerings** (the sellable services), CLI schema:
   ```bash
   acp offering create --file acp/offerings.cli.json
   acp offering list --json     # confirm UUIDs
   ```
   - **Two schemas** (repo doc 05): **CLI uses `price:{type,value}`**; **Web UI ("Import Agent
     Offerings" on app.virtuals.io) uses `priceV2:{type,value}`**. Field is **`requirement`
     (singular)**. Name is **camelCase, no spaces**. Mixing them = silent rejection.
   - Max **40 offerings per agent** (delete before re-creating — repo E21).
5. **Operate** — provider job lifecycle (repo docs 00/07):
   `OPEN → set-budget → FUNDED → submit → COMPLETED`. Every `create-job` MUST embed
   `offering_id` in requirements (`{"offering_id":"...","token":"BTC"}`) or the provider defaults to
   `unknown`/$0.25 and delivers garbage (repo E2/E17).
6. **Marketplace surface**: the agent, its offerings, jobs, and ERC-8004 reputation now appear on
   the Virtuals/OKX marketplace. For OKX-specific listing/growth flows, follow the OKX.ai console
   (the `okx-ai` / `okx-agentic-wallet` skills in this environment cover its ERC-8004 register /
   task-marketplace surface). **⚠️ The precise OKX.ai submission UI is out of scope of the fetched
   quickstart** — verify on os.virtuals.io / OKX console at build time.

---

## 4. Monorepo generation — recommended scaffold

What the "Create agent via LLM → monorepo" feature should emit (TypeScript / GAME + ACP-v2). Layout
bakes in every hard-won lesson from the prod repo (two `EnvironmentFile`, `ExecStopPost`, restricted
signer, `ACP_CONFIG_DIR` isolation, both offering schemas, placeholder-only `.env`, swap):

```
<agent-slug>/
├── README.md                     # what it is · tokenId · TBA · ERC-8004 agentId · run steps
├── LICENSE                       # MIT (match the estate)
├── .gitignore                    # .env, .env.local, signer-keys.json, *.keyring, node_modules
├── .env.example                  # PLACEHOLDERS ONLY — GAME_API_KEY, ANTHROPIC_API_KEY,
│                                  #   ACP_CONFIG_DIR, AGENT_NAME, AGENT_WALLET_ADDRESS, OWNER_WALLET_ADDRESS
├── package.json                  # @virtuals-protocol/game, acp-node-v2, game-acp-plugin, dotenv
├── tsconfig.json
├── soul/
│   ├── neural_soul.md            # from soul.ts soulToMarkdown()
│   └── ai_soul.json              # from soul.ts buildAiSoul() — the on-chain soul copy
├── src/
│   ├── index.ts                  # entrypoint: dotenv → agent.init() → agent.run(60)
│   ├── agent.ts                  # GameAgent(GAME_API_KEY, {name, goal, description, workers})
│   │                              #   goal/description/persona derived from ai_soul (system_prompt, temperature)
│   ├── acp.ts                    # acp-node-v2 AcpAgent + JobSession wiring; embeds offering_id in requirements
│   └── workers/                  # GameWorker + GameFunction handlers (one file per capability)
├── acp/
│   ├── offerings.cli.json        # schema B: price:{type,value}, requirement (singular), camelCase names
│   ├── offerings.webui.json      # schema A: priceV2:{type,value}
│   └── resources.json            # read-only discovery endpoints (name, description, url, params)
├── ops/
│   ├── setup.sh                  # non-root user + 2GB swap (npm/pip OOM in 1GB) + node + python3.12
│   ├── deploy.sh                 # copy code + configs + .env.local
│   ├── register-signers.sh       # acp agent add-signer --policy restricted (new signer per machine)
│   └── systemd/agent.service     # TWO EnvironmentFile (.env then -.env.local) + ExecStopPost pkill
└── scripts/
    └── create-agent.sh           # the exact acp-cli command block (configure → create → add-signer → topup)
```

Generation is a pure function of `{soul, tokenId, contractAddress, tba, agentId?, offerings[]}`,
LLM-expanded via `llm.ts`:
- `ai_soul.json` / `neural_soul.md` come straight from `soul.ts` (`buildAiSoul`, `soulToMarkdown`) —
  **no LLM needed**, deterministic.
- The LLM (`streamChat`) authors `src/agent.ts` goal/description, the `workers/*` `GameFunction`
  handlers, `offerings.*.json` bodies (respecting both schemas), and the README — seeded by the
  soul's `system_prompt` + personality.
- `.env.example` is **placeholders only** — never write a real `localStorage` key into a generated
  file (matches repo doc 03 hygiene).
- Deliver as a **ZIP download** (browser: build the file map, zip client-side) — no server needed.

---

## 5. iIrys integration blueprint

### 5.1 A new optional "Agent" step

Insert an **optional** step after `seal` in `web/src/wizard/wizardStore.ts`:

```ts
export const STEP_IDS = [..., "seal", "agent"] as const;   // agent is last + optional
// add to WizardState: agentOn: boolean (default false — OPTIONAL, mirror soulsOn)
// stepDone("agent"): true when !agentOn OR the user has taken/declined an action
```
- Gate it: only enabled once `sealedAt != null` and a token is minted (needs `tokenId` + the
  sealed `tokenURI`). Reuse `forgeStore.active` for the contract address and the mint receipt for
  `tokenId`.
- Render **two tracks** (both optional, non-blocking):
  - **Bind on-chain** → calls `agent.ts` (§5.2) A-functions; shows TBA address, ERC-8004 `agentId`,
    tx hashes on BaseScan.
  - **Generate agent + monorepo** → pick runtime (GAME/ACP-v2), LLM-expand from the soul, download
    ZIP + `offerings.json` + `.env.example`, and show the copy-paste terminal block + a "what runs
    in a terminal and why" explainer (keyring / P256 / OAuth cannot run in a browser).
- Keep the design dark-first / editorial to match the app; this step is a *hand-off console*, not a
  wizard gate — the collection is already complete at `seal`.

### 5.2 `web/src/forge/agent.ts` — the module

Mirror `deploy.ts` conventions (ethers v6 `BrowserProvider`, Base guard, one tx per action, user
signs). Proposed surface:

```ts
// ── constants ────────────────────────────────────────────────
export const ERC8004_IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"; // Base
// reuse ERC6551_REGISTRY / ERC6551_IMPLEMENTATION from ./deploy.ts

// ── A. on-chain (browser, user signs via Privy) ──────────────
export async function predictTokenAccount(contract: string, tokenId: bigint): Promise<string>;
export async function createTokenAccount(p: Eip1193Provider, contract: string, tokenId: bigint):
  Promise<{ tba: string; txHash: string }>;                       // CloneForge.createTokenAccount

export async function registerErc8004(p: Eip1193Provider, agentURI: string, meta?: MetadataEntry[]):
  Promise<{ agentId: bigint; txHash: string }>;                   // reads Registered event for agentId
export async function setAgentWallet8004(p: Eip1193Provider, agentId: bigint, wallet: string):
  Promise<string>;                                                // builds EIP-712 digest, gets 1271/ECDSA sig, sends tx
export async function setAgentMetadata(p: Eip1193Provider, agentId: bigint, key: string, value: string):
  Promise<string>;

// ── B. generate (no chain; LLM + soul) ───────────────────────
export interface AgentCard { name: string; description: string; tokenURI: string;
  chainId: 8453; contract: string; tokenId: string; wallet: string; ai_soul: AiSoul; }
export function buildAgentCard(soul: SoulConfig, tokenId: string, contract: string, tba: string): AgentCard;
export function buildOfferings(soul: SoulConfig, mode: "cli" | "webui"): object;   // price vs priceV2
export function buildEnvExample(card: AgentCard): string;          // placeholders only
export function buildCreateAgentScript(card: AgentCard): string;   // the acp-cli command block
export async function generateMonorepo(card: AgentCard, opts: { runtime: "game" | "acp-v2" }):
  Promise<Map<string, string | Uint8Array>>;                      // uses llm.ts streamChat; caller zips
```

- **On-chain calls** go through `ethers.BrowserProvider(provider).getSigner()` (Privy) — identical
  to `deployCloneForge` / `mint`. Guard `chainId === 8453` first. The user signs everything.
- **`setAgentWallet8004`** builds the EIP-712 typed data (domain = registry, `chainId 8453`), gets
  the owner's signature, and passes `newWallet = tba` (ERC-1271 path) — with ECDSA/owner-EOA
  fallback.
- **`generateMonorepo`** consumes `llm.ts` (`streamChat`, BYO key already in `localStorage`) to
  author code/docs; `ai_soul.json` + `neural_soul.md` come from `soul.ts` deterministically.
- **No secrets in output.** `buildEnvExample` emits `GAME_API_KEY=your_game_key_here` etc. — never
  the real localStorage keys.
- Add a small ABI JSON for ERC-8004 (pulled from the deployed contract, §2.2) alongside
  `CloneForgeArtifact.json`.

### 5.3 Feasible in-browser vs terminal handoff

| Fully in-browser (iIrys does it) | Terminal handoff (iIrys prepares it) |
|---|---|
| Deploy CloneForge, mint (already shipped) | `acp configure` (Node + Privy OAuth + keyring) |
| `createTokenAccount` → TBA | `acp agent create` / `add-signer` (P256, Secure Enclave, browser approve) |
| ERC-8004 `register` / `setAgentWallet` / `setMetadata` | `acp wallet topup` / `trade` |
| Build agent card, `ai_soul.json`, `neural_soul.md` | `acp offering create` (publish) |
| LLM-generate the monorepo + offerings + `.env.example` | `git init && git push` (publish to GitHub) |
| Download ZIP, show copy-paste command block | Run the GAME/ACP agent loop; deploy 24/7 (systemd) |

**Why the CLI can't run in-browser (state this in the UI):** it needs a Node runtime, a
Secret-Service/Keychain, a **hardware-bound P256 signer** (not portable, not reproducible in JS), a
Privy **browser-OAuth** owner login, and a **persistent daemon**. None are browser capabilities.
iIrys's job is to make the terminal step *one paste* with everything pre-filled.

---

## 6. Troubleshooting cheatsheet (from `devclone20/troubleshooting-acp-agentes-virtual`)

Actionable gotchas an implementer will hit. (E-codes = repo doc 06.)

- **Agent can't hire itself (E1).** `create-job` from agent A to A's own offering reverts
  (`from == provider`). Agents sharing one Privy owner share a smart account → same `from`. To make
  one agent hire another, they need **separate Virtuals owners**.
- **`offering_id` MUST be in requirements (E2/E7-repo).** ACP does **not** propagate the offering
  name to the provider. Always send `{"offering_id":"...","token":"BTC"}`, else default
  `unknown` + $0.25 budget + garbage deliverable.
- **P256 signer is NOT portable (E3).** Copying `signer-keys.json` Mac→Linux →
  `cipher: message authentication failed` (Secure Enclave). **Register a new signer on each
  machine**; it's non-destructive (an agent can hold several).
- **Client ops need the keyring unlocked (E4/E23).** On a headless server, `create-job/fund/complete`
  throw `KeyRevoked`. Run under `su -l <user> -s /bin/bash -c 'dbus-run-session -- bash script.sh'`
  (wrap the **whole bash script**, not just Python). **Never** `setsid`/`nohup` client ops (orphans
  the PAM session → `KeyRevoked`). Provider ops (set-budget/submit) use the file session key and
  don't need this.
- **`.env` placeholder beats the real key → Claude 401 (E5/E24).** systemd injects `.env`
  (placeholder); `load_dotenv(override=False)` won't overwrite. Fix: a **second**
  `EnvironmentFile=-/home/user/.env.local` (last wins). Always keep both files; verify with
  `tr '\0' '\n' < /proc/$(systemctl show <svc> -p MainPID --value)/environ | grep ANTHROPIC`.
- **Two offering schemas (E9).** Web UI = `priceV2:{type,value}`; CLI = `price:{type,value}`. Field
  is **`requirement` (singular)**. Price is **always a nested object**, never a bare number. Names
  camelCase, no spaces. Wrong schema = **silent** rejection.
- **Dual-Field Contract (E10).** Never make a research field strictly required — accept
  `token` OR `topic` with a code-level fallback, or 100% of jobs fail.
- **`acp job list` lies (E11).** Shows `OPEN` when the real state is `BUDGET_SET`. Ground truth =
  `acp job history --job-id <id> --chain-id 8453`.
- **`acp events listen` is unstable (E6).** Crashes with `Server error 500` loops. Use **30s polling
  + exponential backoff** — survives Virtuals API outages and self-recovers.
- **Deliverable must be `result.data`, not `result.output` (E12).** And truncate > 8000 chars.
- **One provider instance per agent wallet (E17/E18).** Two machines running the same agent wallet
  race → garbage deliverables + `execution reverted`. On cutover, **stop/disable the old machine
  first**. systemd units that use `su -l` need `ExecStopPost=-/usr/bin/pkill -9 -f <script>` or the
  child orphans and survives `systemctl stop`.
- **Refresh tokens rotate on each use (E14).** Only one machine may hold the JWTs. Cutover order:
  stop Mac daemons **first**, migrate tokens **second**.
- **`Offering limit of 40 reached` (E21).** Delete before creating:
  `acp offering delete --offering-id <id> --force`.
- **`402 Insufficient credits` (E8).** Runaway spend ($19/24h): huge `soul.md` loaded every session
  on Opus + frequent cron. Right-size the model, trim per-invocation context, monitor cost/token
  from day 1. (Reinforces the Harness "stateless brain over durable log" law.)
- **`fund` fails as `exceeds balance` / `execution reverted`, not "insufficient" (E20).** Escrow is
  **USDC (6 decimals)**. Treat both strings as "no balance" in watchdogs.
- **Signer-state 500 on `job list` v2 (E25).** If one agent's `job list` 500s but `whoami` and
  `--legacy` work, **re-register the signer on that machine** (`add-signer` + approve) — usually
  fixes it client-side without escalating.
- **Isolate multi-agent state (E-repo doc 01).** Never `acp agent use` in automation; inject
  **`ACP_CONFIG_DIR`** into every subprocess.

---

## 7. Sources

- os.virtuals.io quickstart — <https://os.virtuals.io/quickstart> (fetched)
- GAME SDK — <https://github.com/game-by-virtuals/game-node> ; npm `@virtuals-protocol/game@0.1.14`
- ACP SDKs — `@virtuals-protocol/acp-cli@1.0.24`, `@virtuals-protocol/acp-node@0.3.0-beta.40`,
  `@virtuals-protocol/acp-node-v2@0.1.7`, `@virtuals-protocol/game-acp-plugin@0.2.9` (npm registry, 2026-07-08)
- ACP whitepaper — <https://whitepaper.virtuals.io/acp-product-resources/introducing-acp-v2> ,
  <https://whitepaper.virtuals.io/acp-product-resources/acp-onboarding-guide/customize-agent/simulate-agent-with-code/acp-game-plugin>
- ERC-8004 — EIP <https://eips.ethereum.org/EIPS/eip-8004> ; contracts
  <https://github.com/erc-8004/erc-8004-contracts> (`contracts/IdentityRegistryUpgradeable.sol`,
  `abis/IdentityRegistry.json`, fetched) ; Base Identity Registry
  `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- ERC-6551 — registry `0x000000006551c19487814612e58FE06813775758`, impl
  `0x41C8f39463A868d3A88af00cd0fe7102F30E44eC` (from `web/src/forge/deploy.ts`)
- User's production troubleshooting repo —
  <https://github.com/devclone20/troubleshooting-acp-agentes-virtual> (README, CONTEXT-CLAUDE-CODE,
  docs 00–07, cloned + read in full)
- In-repo — `contracts/src/CloneForge.sol`, `web/src/{soul.ts,llm.ts,mint.ts,config.ts}`,
  `web/src/forge/{deploy.ts,forgeStore.ts}`, `web/src/wizard/wizardStore.ts`
- Harness definition — `the HARNESS_ENGINE spec (CLONE FRAME Forge)` (Forge forges Harnesses; laws
  L1–L19; "never an LLM in the signing path"; `@virtuals-protocol/acp-node` for signing)
```
