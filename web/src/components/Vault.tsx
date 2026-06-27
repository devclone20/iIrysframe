import { useEffect, useMemo, useState } from "react";
import { useWallet } from "../wallet";
import { useStore } from "../store";
import type { InvItem, Collection } from "../inventory";
import { groupCollections } from "../inventory";
import { BASE } from "../config";
import { canMint, mint } from "../mint";
import { Drawer, CopyField, toast, errMsg } from "../ui";

export function Vault() {
  const w = useWallet();
  const store = useStore();
  const [text, setText] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null); // null = folders view
  const [chip, setChip] = useState<string | null>(null);
  const [active, setActive] = useState<InvItem | null>(null);

  const collections = useMemo(() => groupCollections(store.inventory), [store.inventory]);
  const open = useMemo(() => collections.find((c) => c.key === openKey) ?? null, [collections, openKey]);

  // If the open folder disappears after a sync, fall back to the folders view.
  useEffect(() => {
    if (openKey && !open) setOpenKey(null);
  }, [openKey, open]);

  const totals = useMemo(() => {
    const items = store.inventory.length;
    const mintable = store.inventory.filter((i) => i.mintable).length;
    return { items, collections: collections.length, mintable };
  }, [store.inventory, collections]);

  return (
    <section className="view">
      <article className="panel panel--vault">
        <header className="panel__head panel__head--vault">
          {open ? (
            <nav className="crumb">
              <button className="crumb__back" onClick={() => { setOpenKey(null); setChip(null); }}>
                ← Collections
              </button>
              <span className="crumb__sep">/</span>
              <h2 className="crumb__here">
                <span className="crumb__dot" />
                {open.name}
              </h2>
            </nav>
          ) : (
            <h2>
              <span className="step">▤</span> Collections
            </h2>
          )}

          <div className="vault-tools">
            <input
              className="search"
              type="search"
              placeholder={open ? "Search this collection…" : "Search collection or item…"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="btn btn--ghost btn--mini"
              onClick={() => store.loadInventory(true)}
              disabled={!w.connected || store.inventoryLoading}
            >
              {store.inventoryLoading ? "Syncing…" : "⟳ Sync"}
            </button>
          </div>
        </header>

        {!open && store.inventory.length > 0 && (
          <div className="vault-summary">
            <Metric n={totals.collections} label={totals.collections === 1 ? "collection" : "collections"} />
            <Metric n={totals.items} label={totals.items === 1 ? "item" : "items"} />
            <Metric n={totals.mintable} label="ready to mint" accent />
          </div>
        )}

        {open ? (
          <CollectionView coll={open} text={text} chip={chip} setChip={setChip} onOpen={setActive} />
        ) : (
          <FoldersView
            collections={collections}
            text={text}
            connected={w.connected}
            loading={store.inventoryLoading}
            onOpen={(k) => { setOpenKey(k); setText(""); setChip(null); }}
          />
        )}
      </article>

      <Drawer open={!!active} onClose={() => setActive(null)}>
        {active && <ItemDetail it={active} onClose={() => setActive(null)} />}
      </Drawer>
    </section>
  );
}

function Metric({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="vmetric">
      <strong className={accent ? "is-accent" : ""}>{n}</strong>
      <span>{label}</span>
    </div>
  );
}

// ── Folders (collections) view ───────────────────────────────────────────────
function FoldersView({
  collections,
  text,
  connected,
  loading,
  onOpen,
}: {
  collections: Collection[];
  text: string;
  connected: boolean;
  loading: boolean;
  onOpen: (key: string) => void;
}) {
  const q = text.trim().toLowerCase();
  const list = useMemo(() => {
    if (!q) return collections;
    return collections.filter(
      (c) => c.name.toLowerCase().includes(q) || c.items.some((i) => (i.name ?? "").toLowerCase().includes(q)),
    );
  }, [collections, q]);

  if (collections.length === 0) {
    return (
      <div className="empty">
        <div className="empty__glyph">◈</div>
        <p>
          {!connected
            ? "Connect your wallet to load your on-chain inventory."
            : loading
              ? "Loading your vault…"
              : "No collections yet. Seal layers in the Engine to get started."}
        </p>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="empty">
        <div className="empty__glyph">⌕</div>
        <p>No collection matches “{text}”.</p>
      </div>
    );
  }

  return (
    <div className="coll-grid">
      {list.map((c) => (
        <FolderCard key={c.key} coll={c} onOpen={() => onOpen(c.key)} />
      ))}
    </div>
  );
}

function FolderCard({ coll, onOpen }: { coll: Collection; onOpen: () => void }) {
  const cells = [0, 1, 2, 3];
  const tiers = Object.entries(coll.tiers);
  return (
    <button className="coll" onClick={onOpen}>
      <div className="coll__cover">
        <div className="coll__mosaic" data-count={Math.min(coll.covers.length, 4)}>
          {cells.map((i) =>
            coll.covers[i] ? (
              <span key={i} className="coll__cell">
                <img loading="lazy" src={coll.covers[i]} alt="" />
              </span>
            ) : (
              <span key={i} className="coll__cell coll__cell--empty" />
            ),
          )}
        </div>
        <span className="coll__count">{coll.items.length}</span>
      </div>
      <div className="coll__body">
        <div className="coll__name" title={coll.name}>
          <span className="coll__folder" aria-hidden="true">▤</span>
          {coll.name}
        </div>
        <div className="coll__meta">
          {coll.items.length} {coll.items.length === 1 ? "item" : "items"}
          {coll.mintable > 0 && <span className="coll__mint"> · {coll.mintable} to mint</span>}
        </div>
        {tiers.length > 0 && (
          <div className="coll__tiers">
            {tiers.map(([t, n]) => (
              <span key={t} className={`coll__tier tier-${t}`}>
                {t} {n}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// ── Inside a collection ──────────────────────────────────────────────────────
function CollectionView({
  coll,
  text,
  chip,
  setChip,
  onOpen,
}: {
  coll: Collection;
  text: string;
  chip: string | null;
  setChip: (c: string | null) => void;
  onOpen: (it: InvItem) => void;
}) {
  const byTier = useMemo(() => {
    const m: Record<string, number> = {};
    coll.items.forEach((it) => it.tier && (m[it.tier] = (m[it.tier] ?? 0) + 1));
    return m;
  }, [coll]);

  const list = useMemo(() => {
    const q = text.toLowerCase();
    return coll.items.filter((it) => {
      if (chip && it.tier !== chip) return false;
      if (!q) return true;
      return [it.name, it.item, it.metadata?.id, it.final?.id].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [coll, text, chip]);

  const tiers = Object.keys(byTier);

  return (
    <>
      {tiers.length > 0 && (
        <div className="chips">
          <button className={`chip ${!chip ? "is-active" : ""}`} onClick={() => setChip(null)}>
            All<span className="chip__count">{coll.items.length}</span>
          </button>
          {tiers.map((t) => (
            <button key={t} className={`chip ${chip === t ? "is-active" : ""}`} onClick={() => setChip(t)}>
              {t}
              <span className="chip__count">{byTier[t]}</span>
            </button>
          ))}
        </div>
      )}

      {list.length > 0 ? (
        <div className="items">
          {list.map((it) => (
            <ItemCard key={it.item} it={it} onOpen={() => onOpen(it)} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="empty__glyph">⌕</div>
          <p>No item matches the filter.</p>
        </div>
      )}
    </>
  );
}

function ItemCard({ it, onOpen }: { it: InvItem; onOpen: () => void }) {
  const thumb = it.final?.url ?? it.layers[0]?.url;
  return (
    <div className="item" onClick={onOpen}>
      <div className="item__media">
        {it.tier && <span className={`item__tier tier-${it.tier}`}>{it.tier}</span>}
        {thumb ? <img loading="lazy" src={thumb} alt="" /> : <div className="ph">no image</div>}
        <div className="item__stack">
          {it.layers.slice(0, 6).map((_, i) => (
            <span className="item__layerdot" key={i} />
          ))}
        </div>
      </div>
      <div className="item__body">
        <div className="item__name">{it.name}</div>
        <div className="item__sub">
          {it.layers.length} layers · {it.collection ?? "—"}
        </div>
        <div className="status">
          <span className={it.layers.length > 0 ? "on" : ""} />
          <span className={it.final ? "on" : ""} />
          <span className={it.metadata ? "on" : ""} />
        </div>
        <div className="status-legend">
          <span>layers</span>
          <span>final</span>
          <span>mint link</span>
        </div>
      </div>
    </div>
  );
}

function ItemDetail({ it, onClose }: { it: InvItem; onClose: () => void }) {
  const w = useWallet();
  const hero = it.final?.url ?? it.layers[0]?.url;
  const [minting, setMinting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  async function doMint() {
    if (!it.metadata) return;
    if (!w.connected || !w.address) return toast("Connect your wallet first", "err");
    setMinting(true);
    try {
      if (!w.onBase) await w.switchToBase();
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet unavailable — reconnect.");
      const hash = await mint(provider, w.address, it.metadata.url);
      setTxHash(hash);
      toast(`Mint sent: ${hash.slice(0, 10)}…`, "ok");
    } catch (e) {
      toast(`Mint failed: ${errMsg(e)}`, "err");
    } finally {
      setMinting(false);
    }
  }

  return (
    <>
      <button className="dd__close" onClick={onClose}>
        ✕
      </button>
      <div className="dd__media">{hero ? <img src={hero} alt="" /> : <div className="ph">no image</div>}</div>
      <div className="dd__title">{it.name}</div>
      <div className="dd__meta">
        {it.layers.length} layers · {it.collection ? `${it.collection} · ` : ""}
        {it.tier ?? "no tier"}
      </div>

      {it.layers.length > 0 && (
        <div className="dd__row">
          <span>Layers (bottom → top)</span>
          <div className="dd__layers">
            {it.layers.map((l) => (
              <img key={l.id} src={l.url} title={`${l.name} (#${l.index})`} alt="" />
            ))}
          </div>
        </div>
      )}

      {it.final && (
        <div className="dd__row">
          <span>Final image</span>
          <CopyField value={it.final.url} />
        </div>
      )}

      <div className="dd__row">
        <span>🔑 Mint link (tokenURI)</span>
        {it.metadata ? <CopyField value={it.metadata.url} /> : <code>metadata not sealed yet</code>}
      </div>

      {it.metadata && canMint() && (
        <div className="dd__row">
          <button className="btn btn--primary btn--block" onClick={doMint} disabled={minting || !w.connected}>
            {minting ? "Minting…" : !w.connected ? "Connect wallet to mint" : "⬢ Mint on Base"}
          </button>
          {txHash ? (
            <a className="dd__txlink" href={`${BASE.explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
              View transaction on Basescan ↗
            </a>
          ) : (
            <span className="dd__minthint">Mint this tokenURI on your contract on Base. Owner/minters mint for free.</span>
          )}
        </div>
      )}
      {it.metadata && !canMint() && (
        <div className="dd__row">
          <span className="dd__minthint">Set <code>VITE_MINT_CONTRACT</code> in <code>web/.env</code> and restart to enable minting.</span>
        </div>
      )}

      {it.metadata && (
        <div className="dd__row">
          <span>Mutable metadata URL</span>
          <CopyField value={it.metadata.mutableUrl} />
        </div>
      )}

      <div className="dd__row">
        <span>Item id</span>
        <code>{it.item}</code>
      </div>
    </>
  );
}
