import { useState } from "react";
import { ethers } from "ethers";
import { useWizard } from "../wizard/wizardStore";
import { activeMintContract } from "../forge/forgeStore";
import { useWallet } from "../wallet";
import { BASE } from "../config";
import { toast, errMsg, copy } from "../ui";
import { getPrefs, getKey, PROVIDERS } from "../llm";
import { openSettings } from "../panels";
import { shortAddr } from "../format";
import {
  predictTokenAccount,
  createTokenAccount,
  registerErc8004,
  setAgentMetadata,
  buildAgentCard,
  buildCreateAgentScript,
  generateAgentRepo,
} from "../forge/agent";
import { briefFromSoul, buildBundle, fleshOut as fleshHarness, defaultCaps, type SpendCaps, type HarnessRuntime } from "../forge/harness";
import { makeZip, downloadBlob } from "../forge/zip";

/** Turn a minted iNFT into an agent: bind it on-chain, or forge a runnable
 *  monorepo (a Virtuals agent, or a full crew Harness) from its soul. */
export function Agent() {
  return (
    <section className="view">
      <div className="forge">
        <div className="forge__col">
          <BindOnChain />
        </div>
        <div className="forge__col">
          <ForgeAgent />
          <ForgeHarness />
        </div>
      </div>
    </section>
  );
}

function llmConnected() {
  const prefs = getPrefs();
  const provider = PROVIDERS.find((p) => p.id === prefs.provider) ?? PROVIDERS[0]!;
  const ok = provider.id === "custom" ? !!prefs.customBaseUrl && !!getKey(provider.id) : !!getKey(provider.id);
  return { ok, prefs, provider };
}

// ── Track A: bind the NFT to an agent on-chain ───────────────────────────────
function BindOnChain() {
  const w = useWallet();
  const [contract, setContract] = useState(activeMintContract() ?? "");
  const [tokenId, setTokenId] = useState("1");
  const [tba, setTba] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  const idNum = () => {
    const n = Number(tokenId);
    if (!Number.isInteger(n) || n < 1) throw new Error("Enter a token id (1, 2, …)");
    return BigInt(n);
  };

  async function predict() {
    if (!ethers.isAddress(contract)) return toast("Enter your collection contract address", "err");
    setBusy("predict");
    try {
      setTba(await predictTokenAccount(contract, idNum()));
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy("");
    }
  }

  async function createWallet() {
    if (!w.connected) return toast("Connect your wallet first", "err");
    if (!w.onBase) return toast("Switch to Base first", "err");
    setBusy("tba");
    try {
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet provider unavailable");
      const out = await createTokenAccount(provider, contract, idNum());
      setTba(out.tba);
      toast(`Agent wallet created — ${shortAddr(out.tba)}`, "ok");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy("");
    }
  }

  async function registerIdentity() {
    if (!w.connected) return toast("Connect your wallet first", "err");
    if (!w.onBase) return toast("Switch to Base first", "err");
    setBusy("register");
    try {
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet provider unavailable");
      // read the token's soul URI on-chain
      const rpc = new ethers.JsonRpcProvider(BASE.rpc);
      const c = new ethers.Contract(contract, ["function tokenURI(uint256) view returns (string)"], rpc);
      const uri = (await c.tokenURI!(idNum())) as string;
      if (!uri) throw new Error("This token has no tokenURI yet");
      const out = await registerErc8004(provider, uri);
      setAgentId(out.agentId.toString());
      toast(`ERC-8004 identity registered — agentId ${out.agentId}`, "ok");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy("");
    }
  }

  async function linkWallet() {
    if (!agentId || !tba) return toast("Register the identity and create the wallet first", "err");
    setBusy("link");
    try {
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet provider unavailable");
      const hash = await setAgentMetadata(provider, BigInt(agentId), "agentWallet", tba);
      toast(`Linked — ${hash.slice(0, 10)}…`, "ok");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy("");
    }
  }

  return (
    <article className="panel">
      <header className="panel__head">
        <h2>Bind on-chain</h2>
        <span className="panel__hint">the NFT becomes the agent</span>
      </header>
      <p className="folder-legend">
        Give a minted iNFT its own <strong>ERC-6551 wallet</strong> (its vault), then register an{" "}
        <strong>ERC-8004 identity</strong> that shares the token's soul. Whoever holds the NFT controls the agent. You
        sign each step in your own wallet, on Base.
      </p>
      <div className="form">
        <div className="field">
          <label>Collection contract</label>
          <input value={contract} onChange={(e) => setContract(e.target.value.trim())} placeholder="0x…" />
        </div>
        <div className="field">
          <label>Token id</label>
          <input type="number" min={1} value={tokenId} onChange={(e) => setTokenId(e.target.value)} />
        </div>
      </div>

      <div className="agent-steps">
        <div className="agent-step">
          <div>
            <strong>1 · Agent wallet (ERC-6551)</strong>
            <em>{tba ? shortAddr(tba) : "not created yet"}</em>
          </div>
          <div className="agent-step__btns">
            <button className="btn btn--ghost btn--mini" onClick={predict} disabled={busy !== ""}>
              {busy === "predict" ? "…" : "Predict"}
            </button>
            <button className="btn btn--mini" onClick={createWallet} disabled={busy !== "" || !w.connected}>
              {busy === "tba" ? "…" : "Create wallet"}
            </button>
          </div>
        </div>
        <div className="agent-step">
          <div>
            <strong>2 · Identity (ERC-8004)</strong>
            <em>{agentId ? `agentId ${agentId}` : "not registered"}</em>
          </div>
          <button className="btn btn--mini" onClick={registerIdentity} disabled={busy !== "" || !w.connected}>
            {busy === "register" ? "…" : "Register identity"}
          </button>
        </div>
        <div className="agent-step">
          <div>
            <strong>3 · Link wallet → identity</strong>
            <em>points the identity at the NFT's wallet</em>
          </div>
          <button className="btn btn--mini" onClick={linkWallet} disabled={busy !== "" || !agentId || !tba}>
            {busy === "link" ? "…" : "Link"}
          </button>
        </div>
      </div>
      {tba && (
        <a className="agent-link" href={`${BASE.explorer}/address/${tba}`} target="_blank" rel="noopener noreferrer">
          View the agent wallet on Basescan →
        </a>
      )}
    </article>
  );
}

// ── Track B: forge a runnable Virtuals agent monorepo ────────────────────────
function ForgeAgent() {
  const wiz = useWizard();
  const [soulId, setSoulId] = useState(wiz.souls[0]?.id ?? "");
  const soul = wiz.souls.find((s) => s.id === soulId) ?? wiz.souls[0];
  const [runtime, setRuntime] = useState<"acp-v2" | "game">("acp-v2");
  const [offerName, setOfferName] = useState("consult");
  const [offerPrice, setOfferPrice] = useState(5);
  const [flesh, setFlesh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  async function download() {
    if (!soul) return toast("Create a soul in Create → Souls first", "err");
    setBusy(true);
    setProgress("");
    try {
      const card = buildAgentCard(soul, {
        runtime,
        tokenURI: wiz.sealBaseURI ?? "",
        contract: activeMintContract() ?? "",
        offerings: [{ name: offerName || "consult", priceUsd: Math.max(1, offerPrice), description: `A ${offerName || "consult"} with ${soul.name}.` }],
      });
      const { ok, prefs } = llmConnected();
      const files = await generateAgentRepo(card, {
        fleshOut: flesh && ok,
        providerId: prefs.provider,
        model: prefs.model || undefined,
        onText: (d) => setProgress((p) => (p + d).slice(-400)),
      });
      downloadBlob(makeZip(files), `${card.slug}-agent.zip`);
      toast(`Agent repo downloaded — ${card.slug}-agent.zip`, "ok");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const script = soul ? buildCreateAgentScript(buildAgentCard(soul, { runtime })) : "";

  return (
    <article className="panel">
      <header className="panel__head">
        <h2>Forge agent + monorepo</h2>
        <span className="panel__hint">Virtuals GAME / ACP · GitHub-ready</span>
      </header>
      <p className="folder-legend">
        Compile a soul into a runnable Virtuals agent repo — GAME brain, ACP-v2 worker, offerings in both schemas,
        and the acp-cli onboarding block. The soul is deterministic from the iNFT; the code is authored by your own
        LLM if connected. Download and publish to GitHub.
      </p>
      <div className="form">
        <div className="field">
          <label>Soul</label>
          <select value={soul?.id ?? ""} onChange={(e) => setSoulId(e.target.value)}>
            {wiz.souls.map((s, i) => (
              <option key={s.id} value={s.id}>{s.name || s.preset || `Soul ${i + 1}`}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Runtime</label>
          <div className="doc-switch">
            <button className={runtime === "acp-v2" ? "is-active" : ""} onClick={() => setRuntime("acp-v2")}>ACP v2</button>
            <button className={runtime === "game" ? "is-active" : ""} onClick={() => setRuntime("game")}>GAME</button>
          </div>
        </div>
      </div>
      <div className="form">
        <div className="field">
          <label>Offering name</label>
          <input value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder="consult" />
        </div>
        <div className="field">
          <label>Price (USD)</label>
          <input type="number" min={1} value={offerPrice} onChange={(e) => setOfferPrice(Number(e.target.value) || 1)} />
        </div>
      </div>
      <FleshToggle flesh={flesh} setFlesh={setFlesh} />
      {progress && <pre className="agent-progress">{progress}</pre>}
      <div className="agent-actions">
        <button className="btn btn--primary" onClick={download} disabled={busy || !soul}>
          {busy ? progress ? "Writing…" : "Building…" : "Download agent repo (.zip)"}
        </button>
        <button className="btn btn--ghost btn--mini" onClick={() => copy(script, "Onboarding script copied")} disabled={!soul}>
          Copy acp-cli block
        </button>
      </div>
      <p className="agent-note">
        The ACP agent's signer, keyring and 24/7 daemon can't run in a browser — the repo is prefilled so the terminal
        step is one paste. iIrys builds it; you run it on your machine.
      </p>
    </article>
  );
}

// ── Track C: forge a full crew Harness ───────────────────────────────────────
function ForgeHarness() {
  const wiz = useWizard();
  const [soulId, setSoulId] = useState(wiz.souls[0]?.id ?? "");
  const soul = wiz.souls.find((s) => s.id === soulId) ?? wiz.souls[0];
  const [runtime, setRuntime] = useState<HarnessRuntime>("acp");
  const [caps, setCaps] = useState<SpendCaps>(defaultCaps());
  const [allow, setAllow] = useState("");
  const [flesh, setFlesh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  async function download() {
    if (!soul) return toast("Create a soul in Create → Souls first", "err");
    setBusy(true);
    setProgress("");
    try {
      const allowlist = allow.split(/[,\s]+/).map((a) => a.trim()).filter((a) => ethers.isAddress(a));
      const brief = briefFromSoul(soul, { runtime, caps, allowlist, chains: [8453], tokenId: "dry-run" });
      let bundle = buildBundle(brief);
      const { ok, prefs } = llmConnected();
      if (flesh && ok) {
        bundle = await fleshHarness(bundle, brief, {
          providerId: prefs.provider,
          model: prefs.model || "",
          onText: (d) => setProgress((p) => (p + d).slice(-400)),
        });
      }
      downloadBlob(makeZip(bundle.files), `${bundle.slug}-harness.zip`);
      toast(`Harness repo downloaded — ${bundle.slug}-harness.zip`, "ok");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const capField = (label: string, key: keyof SpendCaps) => (
    <div className="field">
      <label>{label} (USD)</label>
      <input type="number" min={0} value={caps[key]} onChange={(e) => setCaps({ ...caps, [key]: Number(e.target.value) || 0 })} />
    </div>
  );

  return (
    <article className="panel">
      <header className="panel__head">
        <h2>Forge a Harness</h2>
        <span className="panel__hint">crew · policy · signer boundary</span>
      </header>
      <p className="folder-legend">
        Compile a soul into a full <strong>crew Harness</strong> — 8 role contracts, deterministic guardrail hooks, a
        money-boundary policy, and a signer stub with the boundary drawn. It ships <code>HARNESS_MODE=dry_run</code> by
        default; the browser never signs. Run it on your own droplet.
      </p>
      <div className="form">
        <div className="field">
          <label>Soul</label>
          <select value={soul?.id ?? ""} onChange={(e) => setSoulId(e.target.value)}>
            {wiz.souls.map((s, i) => (
              <option key={s.id} value={s.id}>{s.name || s.preset || `Soul ${i + 1}`}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Target</label>
          <select value={runtime} onChange={(e) => setRuntime(e.target.value as HarnessRuntime)}>
            <option value="acp">Virtuals ACP</option>
            <option value="okx">OKX.ai</option>
            <option value="game">GAME</option>
            <option value="generic">Generic LLM</option>
          </select>
        </div>
      </div>
      <span className="wizard__sub">Spend caps <em>(the money boundary)</em></span>
      <div className="form">
        {capField("Per tx", "perTxUsd")}
        {capField("Per day", "perDayUsd")}
      </div>
      <div className="form">
        {capField("Lifetime", "lifetimeUsd")}
        {capField("Owner gate", "ownerGateUsd")}
      </div>
      <div className="field">
        <label>Recipient allowlist <em>(comma-separated addresses)</em></label>
        <input value={allow} onChange={(e) => setAllow(e.target.value)} placeholder="0x…, 0x…" />
      </div>
      <FleshToggle flesh={flesh} setFlesh={setFlesh} />
      {progress && <pre className="agent-progress">{progress}</pre>}
      <div className="agent-actions">
        <button className="btn btn--primary" onClick={download} disabled={busy || !soul}>
          {busy ? "Compiling…" : "Download Harness repo (.zip)"}
        </button>
      </div>
    </article>
  );
}

function FleshToggle({ flesh, setFlesh }: { flesh: boolean; setFlesh: (v: boolean) => void }) {
  const { ok, provider } = llmConnected();
  return (
    <label className="agent-flesh">
      <input type="checkbox" checked={flesh && ok} disabled={!ok} onChange={(e) => setFlesh(e.target.checked)} />
      <span>
        Author the code with my LLM
        {ok ? <em> · {provider.label}</em> : (
          <button className="agent-flesh__link" onClick={(e) => { e.preventDefault(); openSettings("assistant"); }}>
            connect an LLM
          </button>
        )}
      </span>
    </label>
  );
}
