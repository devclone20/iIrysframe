import { useMemo, useState } from "react";
import {
  useWizard,
  patchWizard,
  goStep,
  stepDone,
  nextPending,
  addSoul,
  patchSoul,
  removeSoul,
  assignSouls,
  setItemNames,
  resetWizard,
  STEP_IDS,
  STEP_META,
  type StepId,
} from "../wizard/wizardStore";
import { generateNames, NAME_SETS, SCHEME_INFO, type NamingScheme, type IdFormat } from "../wizard/naming";
import { SOUL_PRESETS, SOUL_PRESET_NAMES, SOUL_MODELS } from "../soul";
import { useForge, patchDrop, addDeployed, type TierShare } from "../forge/forgeStore";
import { deployCloneForge, estimateDeployEth, DEV_WALLET } from "../forge/deploy";
import { useWallet } from "../wallet";
import { useStore } from "../store";
import { usdOf, shortAddr } from "../format";
import { toast, errMsg, confirmDialog } from "../ui";
import { BASE } from "../config";
import { StepUpload, StepProcess, StepSeal } from "./CreateSteps";

export function Create({ goLaunch }: { goLaunch: () => void }) {
  const wiz = useWizard();
  const step = wiz.step;

  return (
    <section className="view wizard">
      <aside className="wizard__rail panel">
        <div className="wizard__railhead">
          <strong>Create</strong>
          <button className="btn btn--ghost btn--mini" onClick={() => confirmDialog("Start over", "Clear every choice and asset of this draft?", "Reset").then((ok) => ok && resetWizard())}>
            Reset
          </button>
        </div>
        {STEP_IDS.map((id, i) => {
          const done = stepDone(id);
          const current = step === id;
          return (
            <button key={id} className={`wizstep ${current ? "is-current" : ""} ${done ? "is-done" : ""}`} onClick={() => goStep(id)}>
              <span className="wizstep__n">{done && !current ? checkGlyph : i + 1}</span>
              <span className="wizstep__meta">
                <strong>{STEP_META[id].label}</strong>
                <em>{STEP_META[id].hint}</em>
              </span>
            </button>
          );
        })}
      </aside>

      <div className="wizard__body">
        {step === "type" && <StepType />}
        {step === "launch" && <StepLaunch />}
        {step === "contract" && <StepContract />}
        {step === "upload" && <StepUpload />}
        {step === "souls" && <StepSouls />}
        {step === "naming" && <StepNaming />}
        {step === "process" && <StepProcess />}
        {step === "seal" && <StepSeal goLaunch={goLaunch} />}
      </div>
    </section>
  );
}

const checkGlyph = (
  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
    <path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function StepShell({
  title,
  lead,
  children,
  canNext,
  nextLabel,
  onNext,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
  canNext: boolean;
  nextLabel?: string;
  onNext?: () => void;
}) {
  const wiz = useWizard();
  const idx = STEP_IDS.indexOf(wiz.step);
  const prev = STEP_IDS[idx - 1];
  const next = STEP_IDS[idx + 1];
  return (
    <article className="panel wizard__panel">
      <header className="wizard__head">
        <h3>{title}</h3>
        <p>{lead}</p>
      </header>
      <div className="wizard__content">{children}</div>
      <footer className="wizard__foot">
        {prev ? (
          <button className="btn btn--ghost" onClick={() => goStep(prev)}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button
          className="btn btn--primary"
          disabled={!canNext}
          onClick={() => {
            if (onNext) onNext();
            else if (next) goStep(next);
          }}
        >
          {nextLabel ?? "Continue"}
        </button>
      </footer>
    </article>
  );
}

/* ── 1 · Type ──────────────────────────────────────────────────────────────── */
function StepType() {
  const wiz = useWizard();
  const scopes =
    wiz.kind === "2d"
      ? ([
          ["collection", "Collection", "a set of finished images"],
          ["layers", "Layer engine", "trait folders → generated collection"],
          ["single", "Single item", "one image, one iNFT"],
        ] as const)
      : ([
          ["collection", "Collection", "several 3D models, sealed together"],
          ["single", "Single item", "one model, one iNFT"],
        ] as const);
  return (
    <StepShell
      title="What are you creating?"
      lead="Pick the art format first — everything after adapts to this choice."
      canNext={stepDone("type")}
    >
      <div className="choice-grid">
        <ChoiceCard
          active={wiz.kind === "3d"}
          title="3D iNFT"
          desc="Animated FBX / GLB models. Optimized in the browser, posters captured automatically, animation plays on OpenSea."
          onPick={() => patchWizard({ kind: "3d", scope: wiz.scope === "layers" ? null : wiz.scope })}
        />
        <ChoiceCard
          active={wiz.kind === "2d"}
          title="2D iNFT"
          desc="Finished images, or trait layers that generate a whole collection with rarity weights."
          onPick={() => patchWizard({ kind: "2d" })}
        />
      </div>
      {wiz.kind && (
        <>
          <span className="wizard__sub">Scope</span>
          <div className="choice-grid choice-grid--3">
            {scopes.map(([key, label, desc]) => (
              <ChoiceCard key={key} active={wiz.scope === key} title={label} desc={desc} onPick={() => patchWizard({ scope: key })} compact />
            ))}
          </div>
        </>
      )}
    </StepShell>
  );
}

/* ── 2 · Launch ────────────────────────────────────────────────────────────── */
function StepLaunch() {
  const wiz = useWizard();
  return (
    <StepShell
      title="How will it launch?"
      lead="Both paths seal your art permanently on Irys — they differ in where collectors mint."
      canNext={stepDone("launch")}
    >
      <div className="choice-grid">
        <ChoiceCard
          active={wiz.launch === "iirys-opensea"}
          title="Mint here · listed on OpenSea"
          desc="You (or your public) mint on your own contract from this platform. OpenSea indexes every mint automatically — royalties, animation and souls included. Full control, no middleman."
          onPick={() => patchWizard({ launch: "iirys-opensea" })}
        />
        <ChoiceCard
          active={wiz.launch === "opensea-console"}
          title="OpenSea drop console"
          desc="We prepare everything (sealed art, metadata, manifest, collection profile) and hand you the exact data to run the drop through OpenSea's own console — allowlists and drop pages managed there."
          onPick={() => patchWizard({ launch: "opensea-console" })}
        />
      </div>
    </StepShell>
  );
}

/* ── 3 · Contract ──────────────────────────────────────────────────────────── */
function StepContract() {
  const wiz = useWizard();
  const forge = useForge();
  const w = useWallet();
  const store = useStore();
  const drop = forge.drop;
  const [cname, setCname] = useState(wiz.naming.collection);
  const [csymbol, setCsymbol] = useState("INFT");
  const [estimate, setEstimate] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  const supplyAuto = wiz.items.length > 0 ? wiz.items.length * Math.max(1, drop.editionsPerItem) : 0;
  const effectiveMax = drop.supplyMode === "fixed" ? supplyAuto : drop.maxSupply;
  const deployed = forge.deployed[0];

  async function estimateNow() {
    try {
      const provider = await w.getProvider();
      if (!provider) return toast("Connect the wallet first", "err");
      setEstimate("…");
      const eth = await estimateDeployEth(provider, {
        name: cname,
        symbol: csymbol,
        royaltyReceiver: w.address ?? "",
        contractURI: forge.profile.sealedUri ?? "",
        dropBaseURI: wiz.sealBaseURI ?? forge.dropManifestUri ?? "",
        drop: { ...drop, maxSupply: effectiveMax },
      });
      setEstimate(Number.parseFloat(eth).toFixed(6));
    } catch (e) {
      setEstimate(null);
      toast(`Estimate failed: ${errMsg(e)}`, "err");
    }
  }

  async function deploy() {
    if (!w.connected) return toast("Connect your wallet first", "err");
    if (!w.onBase) return toast("Switch to Base first", "err");
    // Perpetual dev support is additive to the creator royalty; the contract caps
    // the sum at 10%. Guard here so the user never hits an on-chain revert.
    if (drop.devSupportMode === "perpetual" && drop.royaltyBps + drop.devBps > 1000) {
      return toast(`Perpetual: royalty + developer fee must be ≤ 10% (now ${((drop.royaltyBps + drop.devBps) / 100).toFixed(1)}%). Lower one.`, "err");
    }
    const devLine =
      drop.devSupportMode === "none"
        ? ""
        : `, dev support <strong>${(drop.devBps / 100).toFixed(0)}% ${drop.devSupportMode === "first" ? "first-sale" : "perpetual"}</strong>`;
    const ok = await confirmDialog(
      "Deploy your contract on Base",
      `Deploy <strong>${cname}</strong> (${csymbol}): royalty <strong>${(drop.royaltyBps / 100).toFixed(1)}%</strong>${devLine}, supply <strong>${effectiveMax === 0 ? "unlimited" : effectiveMax}</strong>, public mint <strong>${drop.publicMint ? `ON · ${drop.priceEth || "0"} ETH` : "off"}</strong>${drop.ogGated ? ", OG-gated" : ""}. Gas paid from your wallet in Base ETH; live on Basescan immediately.`,
      "Deploy",
    );
    if (!ok) return;
    setDeploying(true);
    try {
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet provider unavailable");
      const out = await deployCloneForge(provider, {
        name: cname,
        symbol: csymbol,
        royaltyReceiver: w.address ?? "",
        contractURI: forge.profile.sealedUri ?? "",
        dropBaseURI: wiz.sealBaseURI ?? forge.dropManifestUri ?? "",
        drop: { ...drop, maxSupply: effectiveMax },
      });
      addDeployed({ address: out.address, name: cname, symbol: csymbol, txHash: out.txHash, chainId: BASE.id, at: Date.now() });
      patchWizard({ contractSkipped: false });
      toast(`Deployed — ${out.address.slice(0, 10)}…`, "ok");
    } catch (e) {
      toast(`Deploy failed: ${errMsg(e)}`, "err");
    } finally {
      setDeploying(false);
    }
  }

  return (
    <StepShell
      title="Your contract"
      lead="One audited template (ERC-721A + perpetual royalties), every knob yours. Deploy now, or skip and deploy at launch — assets don't need the contract to be sealed."
      canNext={stepDone("contract") || true}
      onNext={() => {
        if (!stepDone("contract")) patchWizard({ contractSkipped: true });
        goStep("upload");
      }}
      nextLabel={stepDone("contract") ? "Continue" : "Skip — deploy at launch"}
    >
      <div className="form">
        <div className="field">
          <label>Network</label>
          <input value="Base (8453) · ETH" readOnly />
        </div>
        <div className="field">
          <label>Royalty (%) <em>ERC-2981, perpetual</em></label>
          <input
            type="number" step="0.5" min={0} max={100}
            value={drop.royaltyBps / 100}
            onChange={(e) => patchDrop({ royaltyBps: Math.round(Math.max(0, Math.min(100, Number(e.target.value) || 0)) * 100) })}
          />
        </div>
        <div className="field">
          <label>Contract name</label>
          <input value={cname} onChange={(e) => setCname(e.target.value)} />
        </div>
        <div className="field">
          <label>Symbol</label>
          <input value={csymbol} onChange={(e) => setCsymbol(e.target.value.toUpperCase())} />
        </div>
      </div>

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
        <div className="form">
          <div className="field">
            <label>Developer fee · {(drop.devBps / 100).toFixed(0)}%</label>
            <input type="range" min={1} max={5} step={1}
              value={Math.round(drop.devBps / 100) || 1}
              onChange={(e) => patchDrop({ devBps: Number(e.target.value) * 100 })} />
          </div>
          <div className="field">
            <label>Fee goes to <em>embedded in your contract</em></label>
            <input value={shortAddr(DEV_WALLET)} readOnly />
          </div>
        </div>
      )}
      <p className="folder-legend">
        {drop.devSupportMode === "none"
          ? "No developer fee. You keep 100% of mint revenue and your full royalty."
          : drop.devSupportMode === "first"
            ? `A ${(drop.devBps / 100).toFixed(0)}% cut of each first sale (mint) goes to the developer who built this tool. Your secondary royalty (${(drop.royaltyBps / 100).toFixed(1)}%) is untouched. The fee only moves when someone actually mints — nothing on free mints.`
            : `The developer receives ${(drop.devBps / 100).toFixed(0)}% of every secondary sale, forever, on top of your ${(drop.royaltyBps / 100).toFixed(1)}% royalty (total ${((drop.royaltyBps + drop.devBps) / 100).toFixed(1)}% to a small, immutable splitter that pays you both automatically). Nothing on the first mint. This is a permanent, on-chain commitment.`}
      </p>

      <span className="wizard__sub">Supply</span>
      <div className="doc-switch">
        <button className={drop.supplyMode === "fixed" ? "is-active" : ""} onClick={() => patchDrop({ supplyMode: "fixed" })}>fixed by my items</button>
        <button className={drop.supplyMode === "open" ? "is-active" : ""} onClick={() => patchDrop({ supplyMode: "open" })}>public drop limit</button>
      </div>
      <div className="form">
        {drop.supplyMode === "fixed" ? (
          <>
            <div className="field">
              <label>Mints per item <em>(editions)</em></label>
              <input type="number" min={1} value={drop.editionsPerItem} onChange={(e) => patchDrop({ editionsPerItem: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
            <div className="field">
              <label>Total supply <em>(auto)</em></label>
              <input value={supplyAuto || "— add assets in the next step"} readOnly />
            </div>
          </>
        ) : (
          <div className="field">
            <label>Max public supply <em>(0 = unlimited)</em></label>
            <input type="number" min={0} value={drop.maxSupply} onChange={(e) => patchDrop({ maxSupply: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
        )}
      </div>

      <label className="e3d__soul">
        <input type="checkbox" checked={drop.publicMint} onChange={(e) => patchDrop({ publicMint: e.target.checked })} />
        Public mint — collectors mint directly from the contract
      </label>
      {drop.publicMint && (
        <div className="form">
          <div className="field">
            <label>Price per mint (ETH){usdOf(drop.priceEth, store.ethUsd) && <em> ≈ {usdOf(drop.priceEth, store.ethUsd)}</em>}</label>
            <input type="number" step="0.001" min={0} value={drop.priceEth} onChange={(e) => patchDrop({ priceEth: e.target.value })} />
          </div>
          <div className="field">
            <label>Per-wallet limit <em>(0 = none)</em></label>
            <input type="number" min={0} value={drop.walletLimit} onChange={(e) => patchDrop({ walletLimit: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
        </div>
      )}
      <label className="e3d__soul">
        <input type="checkbox" checked={drop.ogGated} onChange={(e) => patchDrop({ ogGated: e.target.checked })} />
        OG card gate — only holders of your OG NFT can mint{drop.publicMint && (drop.priceEth === "0" || drop.priceEth === "") ? " (they pay only gas)" : ""}
      </label>
      {drop.ogGated && (
        <div className="field">
          <label>OG card contract (Base)</label>
          <input value={drop.ogAddress} onChange={(e) => patchDrop({ ogAddress: e.target.value.trim() })} placeholder="0x…" />
        </div>
      )}

      <span className="wizard__sub">Rarity tiers</span>
      <p className="folder-legend">Distributed automatically across your items during processing — override per item there.</p>
      <div className="forge__tiers-inline">
        {drop.tiers.map((t, i) => (
          <div className="forge__tier" key={t.name}>
            <span className="forge__tiername">{t.name}</span>
            <input
              type="number" min={0} max={100} value={t.pct}
              onChange={(e) => {
                const tiers: TierShare[] = drop.tiers.map((x, j) => (j === i ? { ...x, pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : x));
                patchDrop({ tiers });
              }}
            />
            <span className="forge__pct">%</span>
          </div>
        ))}
      </div>

      <div className="irys-actions" style={{ justifyContent: "flex-start", marginTop: 16 }}>
        <button className="btn btn--ghost btn--mini" onClick={estimateNow} disabled={!w.connected}>Estimate gas{estimate ? ` · ≈ ${estimate} ETH` : ""}</button>
        <a className="btn btn--ghost btn--mini" href="/CloneForge.flat.sol" download>Contract source (.sol)</a>
      </div>
      {deployed ? (
        <div className="keylink" style={{ marginTop: 12 }}>
          <span className="keylink__label">Contract live on Base</span>
          <code>{deployed.address}</code>
          <div className="keylink__actions">
            <a className="btn btn--mini" href={`${BASE.explorer}/address/${deployed.address}`} target="_blank" rel="noopener noreferrer">Basescan</a>
          </div>
        </div>
      ) : (
        <button className="btn btn--primary btn--block" disabled={deploying || !w.connected || !w.onBase} onClick={deploy}>
          {deploying ? "Deploying…" : !w.connected ? "Connect wallet to deploy" : !w.onBase ? "Switch to Base" : "Pay gas & deploy on Base"}
        </button>
      )}
    </StepShell>
  );
}

/* ── 5 · Souls ─────────────────────────────────────────────────────────────── */
function StepSouls() {
  const wiz = useWizard();
  const [open, setOpen] = useState<string | null>(wiz.souls[0]?.id ?? null);
  const assignedCount = wiz.items.filter((i) => i.soulId).length;

  return (
    <StepShell
      title="Souls"
      lead="The soul is the agent identity sealed inside each iNFT — whoever holds the token controls it. Use one soul for the whole collection, or create several and mix them randomly across items."
      canNext={!wiz.soulsOn || wiz.souls.length > 0}
      onNext={() => {
        if (wiz.soulsOn) assignSouls();
        goStep("naming");
      }}
    >
      <label className="e3d__soul" style={{ marginTop: 0 }}>
        <input type="checkbox" checked={wiz.soulsOn} onChange={(e) => patchWizard({ soulsOn: e.target.checked })} />
        Embed a Neural Soul in every item
      </label>

      {wiz.soulsOn && (
        <>
          <div className="doc-switch" style={{ marginTop: 12 }}>
            <button className={wiz.soulAssign === "single" ? "is-active" : ""} onClick={() => patchWizard({ soulAssign: "single" })}>one soul for all</button>
            <button className={wiz.soulAssign === "mixed" ? "is-active" : ""} onClick={() => patchWizard({ soulAssign: "mixed" })}>mixed — random per item</button>
          </div>

          <div className="souls-list">
            {wiz.souls.map((s, i) => (
              <div className={`soulcard ${open === s.id ? "is-open" : ""}`} key={s.id}>
                <button className="soulcard__head" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  <strong>{s.name || s.preset || `Soul ${i + 1}`}</strong>
                  <em>{s.personality?.slice(0, 60) || "—"}</em>
                </button>
                {open === s.id && (
                  <div className="soulcard__body">
                    <div className="soul-presets soul-presets--compact">
                      {SOUL_PRESET_NAMES.map((p) => (
                        <button key={p} className="soul-preset" onClick={() => patchSoul(s.id, { ...SOUL_PRESETS[p] })}>
                          load {p}
                        </button>
                      ))}
                    </div>
                    <div className="form">
                      <div className="field">
                        <label>Name</label>
                        <input value={s.name} onChange={(e) => patchSoul(s.id, { name: e.target.value, preset: "Custom" })} />
                      </div>
                      <div className="field">
                        <label>Base model</label>
                        <select value={s.baseModel} onChange={(e) => patchSoul(s.id, { baseModel: e.target.value })}>
                          {SOUL_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="field">
                      <label>Personality</label>
                      <input value={s.personality} onChange={(e) => patchSoul(s.id, { personality: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>System prompt <em>(the agent's behavior)</em></label>
                      <textarea rows={4} value={s.systemPrompt} onChange={(e) => patchSoul(s.id, { systemPrompt: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>Temperature · {s.temperature.toFixed(2)}</label>
                      <input type="range" min={0} max={1} step={0.05} value={s.temperature} onChange={(e) => patchSoul(s.id, { temperature: Number(e.target.value) })} />
                    </div>
                    {wiz.souls.length > 1 && (
                      <button className="btn btn--ghost btn--mini" onClick={() => removeSoul(s.id)}>
                        Remove this soul
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="btn btn--block" onClick={() => setOpen(addSoul().id)}>
            + Add another soul
          </button>

          {wiz.items.length > 0 && (
            <p className="e3d__soulhint" style={{ marginTop: 10 }}>
              {wiz.soulAssign === "mixed"
                ? `${wiz.souls.length} souls will be mixed randomly across ${wiz.items.length} items when you continue.`
                : `"${wiz.souls[0]?.name || "Soul 1"}" rides every one of the ${wiz.items.length} items.`}
              {assignedCount > 0 && ` (currently assigned: ${assignedCount}/${wiz.items.length})`}
            </p>
          )}
        </>
      )}
    </StepShell>
  );
}

/* ── 6 · Naming ────────────────────────────────────────────────────────────── */
function StepNaming() {
  const wiz = useWizard();
  const n = wiz.naming;
  const single = wiz.scope === "single";
  const schemes: NamingScheme[] = single ? ["single"] : ["prefix-seq", "random-id", "nameset-id", "rarity-ranked"];
  const forge = useForge();
  const tierRank = [...forge.drop.tiers].sort((a, b) => a.pct - b.pct).map((t) => t.name); // rarest first

  const preview = useMemo(() => {
    const items = wiz.items.slice(0, 6).map((it, index) => ({ index, tier: it.tier }));
    if (items.length === 0) return [];
    return generateNames({ ...n, scheme: single ? "single" : n.scheme }, items, tierRank);
  }, [n, wiz.items, single, tierRank]);

  function applyAndContinue() {
    const items = wiz.items.map((it, index) => ({ index, tier: it.tier }));
    const names = generateNames({ ...n, scheme: single ? "single" : n.scheme }, items, tierRank);
    setItemNames(names);
    goStep("process");
  }

  return (
    <StepShell
      title="Names"
      lead="Name the collection, then choose how every item gets its own name."
      canNext={!!n.collection.trim() && (!single || !!(n.singleName || n.collection))}
      onNext={applyAndContinue}
    >
      <div className="form">
        <div className="field">
          <label>Collection name</label>
          <input value={n.collection} onChange={(e) => patchWizard({ naming: { ...n, collection: e.target.value, prefix: n.prefix || `${e.target.value} #` } })} />
        </div>
        {single ? (
          <div className="field">
            <label>Item name</label>
            <input value={n.singleName} onChange={(e) => patchWizard({ naming: { ...n, singleName: e.target.value } })} placeholder={n.collection} />
          </div>
        ) : (
          <div className="field">
            <label>Prefix</label>
            <input value={n.prefix} onChange={(e) => patchWizard({ naming: { ...n, prefix: e.target.value } })} placeholder="iCLONE #" />
          </div>
        )}
      </div>

      {!single && (
        <>
          <span className="wizard__sub">Item naming scheme</span>
          <div className="choice-grid choice-grid--4">
            {schemes.map((s) => (
              <ChoiceCard key={s} compact active={n.scheme === s} title={SCHEME_INFO[s].label} desc={SCHEME_INFO[s].hint} onPick={() => patchWizard({ naming: { ...n, scheme: s } })} />
            ))}
          </div>
          {(n.scheme === "random-id" || n.scheme === "nameset-id") && (
            <div className="form">
              <div className="field">
                <label>ID format</label>
                <select value={n.idFormat} onChange={(e) => patchWizard({ naming: { ...n, idFormat: e.target.value as IdFormat } })}>
                  <option value="seq">sequential (1, 2, 3…)</option>
                  <option value="num4">4-digit random (4821)</option>
                  <option value="num6">6-digit random (482913)</option>
                  <option value="hex4">hex (7F3A)</option>
                  <option value="alnum5">alphanumeric (K7X2M)</option>
                </select>
              </div>
              {n.scheme === "nameset-id" && (
                <div className="field">
                  <label>Name set</label>
                  <select value={n.nameset} onChange={(e) => patchWizard({ naming: { ...n, nameset: e.target.value } })}>
                    {Object.entries(NAME_SETS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label} — {v.names.slice(0, 4).join(", ")}…</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
          {n.scheme === "rarity-ranked" && (
            <p className="e3d__soulhint">Requires rarity tiers — they're distributed in the next step; #1 will be the rarest item.</p>
          )}
        </>
      )}

      {preview.length > 0 && (
        <>
          <span className="wizard__sub">Preview</span>
          <div className="name-preview">
            {preview.map((p, i) => (
              <code key={i}>{p}</code>
            ))}
            {wiz.items.length > 6 && <code>… +{wiz.items.length - 6}</code>}
          </div>
        </>
      )}
    </StepShell>
  );
}

/* ── shared card ───────────────────────────────────────────────────────────── */
export function ChoiceCard({
  active,
  title,
  desc,
  onPick,
  compact,
}: {
  active: boolean;
  title: string;
  desc: string;
  onPick: () => void;
  compact?: boolean;
}) {
  return (
    <button className={`choice ${active ? "is-active" : ""} ${compact ? "choice--compact" : ""}`} onClick={onPick}>
      <strong>{title}</strong>
      <span>{desc}</span>
    </button>
  );
}
