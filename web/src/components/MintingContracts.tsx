import { useState } from "react";
import { CONTRACT_TEMPLATES } from "../contracts";
import { BASE } from "../config";
import { MINT_CONFIG } from "../mint";
import { toast } from "../ui";

export function MintingContracts() {
  const [sel, setSel] = useState(CONTRACT_TEMPLATES[0]!.id);
  const t = CONTRACT_TEMPLATES.find((c) => c.id === sel)!;
  const active = MINT_CONFIG.contract.toLowerCase();

  function copyCode() {
    navigator.clipboard.writeText(t.code).then(
      () => toast("Code copied — paste into Remix", "ok"),
      () => toast("Couldn't copy", "err"),
    );
  }
  function downloadSol() {
    const blob = new Blob([t.code], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${t.name.replace(/\s+/g, "")}.sol`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="view">
      <article className="panel" style={{ marginTop: 22 }}>
        <header className="panel__head">
          <h2>
            <span className="step">§</span> Minting Contracts · Base
          </h2>
          <span className="panel__hint">3 templates</span>
        </header>
        <p className="folder-legend">
          Choose the contract you'll mint your agents with on <strong>Base</strong>. The first is the official iCLONE
          (5% perpetual royalty). The other two are royalty-free bases, in case you prefer your own.
        </p>

        {/* selector cards */}
        <div className="ct-grid">
          {CONTRACT_TEMPLATES.map((c) => {
            const isLive = !!c.deployedAt && c.deployedAt.toLowerCase() === active;
            return (
              <button key={c.id} className={`ct-card ${sel === c.id ? "is-active" : ""}`} onClick={() => setSel(c.id)}>
                <div className="ct-card__top">
                  <strong>{c.name}</strong>
                  {c.badge && <span className="ct-card__badge">{c.badge}</span>}
                </div>
                <span className="ct-card__tagline">{c.tagline}</span>
                <div className="ct-card__meta">
                  <span className={c.royalty.startsWith("No") ? "" : "is-royalty"}>{c.royalty}</span>
                </div>
                {isLive && <span className="ct-card__live">● linked to your app</span>}
              </button>
            );
          })}
        </div>
      </article>

      {/* selected template detail */}
      <article className="panel" style={{ marginTop: 18 }}>
        <header className="panel__head">
          <h2>{t.name} <span className="ct-symbol">{t.symbol}</span></h2>
          {t.deployedAt && (
            <a className="btn btn--ghost btn--mini" href={`${BASE.explorer}/address/${t.deployedAt}`} target="_blank" rel="noopener noreferrer">
              Basescan ↗
            </a>
          )}
        </header>

        <p className="ct-desc">{t.description}</p>

        <div className="ct-facts">
          <Fact label="Royalty" value={t.royalty} accent={!t.royalty.startsWith("No")} />
          <Fact label="Who mints" value={t.mintGate} />
          <Fact label="Recommended for" value={t.recommendedFor} />
          {t.deployedAt && <Fact label="Deployed (Base)" value={t.deployedAt} mono />}
        </div>

        <div className="ct-features">
          {t.features.map((f) => (
            <div className="ct-feature" key={f}>
              <span className="ct-feature__dot" /> {f}
            </div>
          ))}
        </div>

        <div className="ct-code-head">
          <span>Solidity · {t.name}.sol</span>
          <div className="ct-code-actions">
            <button className="btn btn--ghost btn--mini" onClick={copyCode}>⧉ Copy</button>
            <button className="btn btn--ghost btn--mini" onClick={downloadSol}>⬇ .sol</button>
          </div>
        </div>
        <pre className="ct-code">{t.code}</pre>

        <div className="ct-deploy">
          <strong>How to deploy:</strong> open <a href="https://remix.ethereum.org" target="_blank" rel="noopener noreferrer">remix.ethereum.org</a> → new <code>.sol</code> file → paste this code → Solidity Compiler (0.8.20+, EVM cancun) → Deploy &amp; Run → <strong>WalletConnect/Injected</strong> on the <strong>Base (8453)</strong> network → fill the constructor → Deploy. Then put the address in <code>web/.env</code> → <code>VITE_MINT_CONTRACT</code> and the <strong>Mint on Base</strong> button (in the Vault) uses it.
        </div>
      </article>
    </section>
  );
}

function Fact({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div className="ct-fact">
      <span>{label}</span>
      <strong className={`${accent ? "is-accent" : ""} ${mono ? "is-mono" : ""}`}>{value}</strong>
    </div>
  );
}
