// Irys Base — the app's window into its own meta-base: the balances that feed
// it (Irys storage credit · ETH on Base · ETH on Robinhood Chain) and every
// published set, organized one folder per collection, straight from the Irys
// index. Refresh re-queries the index, so anything sealed moments ago shows up.

import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useWallet } from "../wallet";
import { groupCollections, type InvItem } from "../inventory";
import { fmtEth, usdOf } from "../format";

function BalanceCard({ label, value, unit, usd }: { label: string; value: string; unit: string; usd?: string | null }) {
  return (
    <div className="ib__bal">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{unit}</em>
      {usd && <span className="ib__bal-usd">≈ {usd}</span>}
    </div>
  );
}

function ItemRow({ it }: { it: InvItem }) {
  return (
    <div className="ib__item">
      <span className="ib__item-name">{it.name}</span>
      <span className="ib__item-meta">
        {it.tier && <em className="ib__chip">{it.tier}</em>}
        {it.layers.length > 0 && <em>{it.layers.length} layers</em>}
        {it.final && (
          <a href={it.final.url} target="_blank" rel="noopener noreferrer">
            art
          </a>
        )}
        {it.metadata && (
          <a href={it.metadata.url} target="_blank" rel="noopener noreferrer">
            metadata
          </a>
        )}
      </span>
    </div>
  );
}

export function IrysBase() {
  const store = useStore();
  const w = useWallet();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const collections = useMemo(() => groupCollections(store.inventory), [store.inventory]);
  const ethRobinhood = store.assets.find((a) => a.def.id === "eth-robinhood");
  const ethBase = store.assets.find((a) => a.def.id === "eth-base");

  async function refreshAll() {
    setBusy(true);
    try {
      await Promise.all([store.loadInventory(true), store.refresh(), store.refreshAssets(true)]);
    } finally {
      setBusy(false);
    }
  }

  if (!w.connected) {
    return (
      <section className="view">
        <article className="panel ib__empty-panel">
          <h3>Irys Base</h3>
          <p>Connect your wallet to see your meta-base: balances and every set published on Irys, folder by folder.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="view ib">
      <header className="ib__head">
        <div className="ib__title">
          <h3>Irys Base</h3>
          <p>
            Your permanent meta-base on Irys — storage credit funds with <strong>Base ETH only</strong> (Irys does not
            accept Robinhood ETH); ETH on Robinhood Chain pays mint & deploy gas there.
          </p>
        </div>
        <button className="btn btn--ghost btn--mini" onClick={refreshAll} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="ib__bals">
        <BalanceCard label="Irys credit" value={fmtEth(store.nodeEth)} unit="storage · Base ETH" usd={usdOf(store.nodeEth, store.ethUsd)} />
        <BalanceCard
          label="ETH · Base"
          value={ethBase?.display ?? fmtEth(store.baseEth)}
          unit="wallet"
          usd={usdOf(ethBase?.display ?? store.baseEth, store.ethUsd)}
        />
        <BalanceCard
          label="ETH · Robinhood Chain"
          value={ethRobinhood?.display ?? "—"}
          unit="mint & deploy gas"
          usd={usdOf(ethRobinhood?.display ?? null, store.ethUsd)}
        />
      </div>

      {store.inventoryLoading && collections.length === 0 ? (
        <article className="panel ib__empty-panel">
          <p>Querying the Irys index…</p>
        </article>
      ) : collections.length === 0 ? (
        <article className="panel ib__empty-panel">
          <p>Nothing published yet — seal a collection in Create and it appears here, in its own folder.</p>
        </article>
      ) : (
        <div className="ib__folders">
          {collections.map((c) => {
            const open = openKey === c.key;
            return (
              <article key={c.key} className={`panel ib__folder ${open ? "is-open" : ""}`}>
                <button className="ib__folder-head" onClick={() => setOpenKey(open ? null : c.key)}>
                  <span className="ib__folder-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <path
                        d="M3 6.5h6l2 2.5h10v9.5H3V6.5Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="ib__folder-name">{c.name}</span>
                  <span className="ib__folder-count">
                    {c.items.length} item{c.items.length === 1 ? "" : "s"}
                    {c.mintable > 0 && <em> · {c.mintable} mintable</em>}
                  </span>
                  <span className="ib__folder-caret">{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div className="ib__folder-body">
                    {c.items.map((it) => (
                      <ItemRow key={it.item} it={it} />
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
