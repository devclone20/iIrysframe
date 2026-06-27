import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useCollection } from "../collection";
import { fmtBytes, fmtEth, usdOf } from "../format";
import { toast, CopyField } from "../ui";

export function Irys({ goVault, goEngine }: { goVault: () => void; goEngine: () => void }) {
  const store = useStore();
  const { staged, cost, computeCost, sealing, progress, receipts, layerReceipts, sealAll } = useCollection();
  const connected = !!store.irys;
  const [showLayers, setShowLayers] = useState(false);

  // (re)price whenever the staged collection or the wallet changes
  useEffect(() => {
    void computeCost();
  }, [computeCost]);

  const totalUploads = staged ? staged.variants.length + staged.items.length * 2 : 0;
  const sealedOk = receipts.filter((r) => r.ok).length;
  const done = receipts.length > 0 && !sealing;

  function exportManifest() {
    if (!staged) return;
    const manifest = {
      collection: staged.collection,
      description: staged.description,
      sealedAt: new Date().toISOString(),
      items: receipts.map((r) => ({ edition: r.edition, name: r.name, tokenURI: r.metadata, image: r.image, dna: r.dna, item: r.item })),
      layers: layerReceipts.map((l) => ({ trait: l.trait, name: l.name, url: l.url })),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${staged.collection.replace(/\s+/g, "-").toLowerCase() || "collection"}-irys.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Manifest exported", "ok");
  }

  return (
    <section className="view">
      <div className="rail">
        <Stat label="Collection" value={staged?.collection || "—"} sub={staged ? "ready to write" : "empty"} />
        <Stat label="Items" value={staged ? `${staged.items.length}` : "0"} sub={staged ? `${staged.variants.length} unique layers` : "build in Engine"} />
        <Stat
          label="Cost"
          value={!staged ? "—" : !connected ? "?" : cost ? (cost.free ? "FREE" : fmtEth(cost.eth)) : "…"}
          sub={
            cost && !cost.free
              ? usdOf(cost.eth, store.ethUsd)
                ? `≈ ${usdOf(cost.eth, store.ethUsd)} · ETH`
                : "ETH on Base"
              : cost?.free
                ? "<100 KiB free"
                : connected
                  ? "calculating"
                  : "connect wallet"
          }
        />
        <Stat label="Written" value={`${sealedOk}`} sub={sealing && progress ? `${progress.phase} ${progress.done}/${progress.total}` : done ? "on Irys ✓" : "not written"} />
      </div>

      {!staged ? (
        <article className="panel">
          <div className="empty">
            <div className="empty__glyph">⬡</div>
            <p>
              No collection queued. Go to the <strong>Engine</strong>, generate your collection and hit “Seal on Irys →”.
            </p>
            <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={goEngine}>
              Go to the Engine
            </button>
          </div>
        </article>
      ) : (
        <div className="irys">
          {/* ── deploy / payment ── */}
          <article className="panel">
            <header className="panel__head">
              <h2>
                <span className="step">↥</span> Send to Irys
              </h2>
              <span className="panel__hint">permanent</span>
            </header>

            <p className="irys-lead">
              Everything queued goes to <strong>Irys</strong> (datachain) and is written forever — you get the link for
              each image and the <strong>tokenURI</strong> (mint link) per item.
            </p>

            <div className="irys-summary">
              <Row label="Collection" value={staged.collection} />
              <Row label="Layers (unique variants)" value={`${staged.variants.length}`} />
              <Row label="Items (final image + metadata)" value={`${staged.items.length}`} />
              <Row label="Total uploads" value={`${totalUploads}`} />
              {cost && <Row label="Total size" value={fmtBytes(cost.bytes)} />}
              {cost && (
                <Row
                  label="Cost"
                  value={
                    cost.free
                      ? "FREE (<100 KiB each)"
                      : `≈ ${fmtEth(cost.eth)} ETH${usdOf(cost.eth, store.ethUsd) ? ` · ${usdOf(cost.eth, store.ethUsd)}` : ""}  ·  ${cost.paidCount} paid / ${cost.freeCount} free`
                  }
                  accent
                />
              )}
            </div>

            {sealing && progress && (
              <div className="irys-progress">
                <div className="irys-progress__bar">
                  <span style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
                </div>
                <span className="irys-progress__txt">
                  {progress.phase === "layers" ? "Writing layers" : "Writing items"} {progress.done}/{progress.total}
                </span>
              </div>
            )}

            <button className="btn btn--primary btn--block" disabled={!connected || sealing} onClick={sealAll}>
              {!connected
                ? "Connect wallet to write"
                : sealing
                  ? "Writing to Irys…"
                  : done
                    ? "Write to Irys again"
                    : cost && !cost.free
                      ? `Seal & pay · ${fmtEth(cost.eth)} ETH`
                      : "Seal all on Irys (free)"}
            </button>
            {done && (
              <div className="irys-actions">
                <button className="btn btn--ghost btn--mini" onClick={exportManifest}>⬇ Export manifest (JSON)</button>
                <button className="btn btn--ghost btn--mini" onClick={goVault}>View in Vault →</button>
              </div>
            )}
          </article>

          {/* ── receipts ── */}
          <article className="panel">
            <header className="panel__head">
              <h2>
                <span className="step">✓</span> Written links
              </h2>
              {layerReceipts.length > 0 && (
                <button className="btn btn--ghost btn--mini" onClick={() => setShowLayers((s) => !s)}>
                  {showLayers ? "Hide layers" : `Layers (${layerReceipts.length})`}
                </button>
              )}
            </header>

            {receipts.length === 0 && layerReceipts.length === 0 ? (
              <div className="empty">
                <div className="empty__glyph">🔗</div>
                <p>After sealing, each item shows its image, the tokenURI (mint link) and the DNA here.</p>
              </div>
            ) : (
              <>
                {showLayers && layerReceipts.length > 0 && (
                  <div className="layerbank">
                    {layerReceipts.map((l) => (
                      <a className="layerbank__row" key={l.id} href={l.url} target="_blank" rel="noopener noreferrer">
                        <span className="layerbank__trait">{l.trait}</span>
                        <span className="layerbank__name">{l.name}</span>
                        <span className="layerbank__link">↗</span>
                      </a>
                    ))}
                  </div>
                )}
                <div className="receipts">
                  {receipts.map((r) => (
                    <div className={`receipt ${r.ok ? "" : "is-err"}`} key={r.edition}>
                      <div className="receipt__head">
                        <strong>{r.name}</strong>
                        {r.ok ? <span className="receipt__ok">on Irys ✓</span> : <span className="receipt__bad">{r.error ?? "failed"}</span>}
                      </div>
                      {r.ok && (
                        <>
                          <div className="receipt__field">
                            <span>🔑 tokenURI (mint link)</span>
                            <CopyField value={r.metadata} />
                          </div>
                          <div className="receipt__field">
                            <span>Image</span>
                            <CopyField value={r.image} />
                          </div>
                          <div className="receipt__dna">DNA {r.dna}</div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value stat__value--sm">{value}</span>
      <span className="stat__sub">{sub}</span>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`irys-row ${accent ? "is-accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
