import { useEffect, useMemo, useState } from "react";
import { useWallet } from "../wallet";
import { useStore } from "../store";
import type { InvItem, Collection } from "../inventory";
import { groupCollections, UNSORTED } from "../inventory";
import { BASE, type Tag } from "../config";
import { canMint, mint } from "../mint";
import { Drawer, Modal, CopyField, toast, errMsg } from "../ui";
import { aliasOf, setAlias, useAliases } from "../renames";
import { useForge, patchProfile, activeMintContract } from "../forge/forgeStore";
import { readContractState, adminCall } from "../forge/deploy";
import { uploadData } from "../irys";

export function Vault() {
  const w = useWallet();
  const store = useStore();
  const [text, setText] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null); // null = folders view
  const [chip, setChip] = useState<string | null>(null);
  const [active, setActive] = useState<InvItem | null>(null);
  const [renaming, setRenaming] = useState<Collection | null>(null);
  const aliases = useAliases();

  const collections = useMemo(
    () => groupCollections(store.inventory).map((c) => ({ ...c, name: aliases[c.key] ?? c.name })),
    [store.inventory, aliases],
  );
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
              {open.key !== UNSORTED && (
                <button className="btn btn--ghost btn--mini" onClick={() => setRenaming(open)}>
                  Rename
                </button>
              )}
            </nav>
          ) : (
            <h2>
              Collections
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
              {store.inventoryLoading ? "Syncing…" : "Sync"}
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

      {renaming && <RenameDialog coll={renaming} onClose={() => setRenaming(null)} />}
    </section>
  );
}

/** Rename a collection: instant local alias + (when a CloneForge contract is
 *  active) a re-sealed profile pushed into contractURI so OpenSea updates too. */
function RenameDialog({ coll, onClose }: { coll: Collection; onClose: () => void }) {
  const w = useWallet();
  const store = useStore();
  const forge = useForge();
  const [name, setName] = useState(coll.name);
  const [busy, setBusy] = useState(false);
  const [canPushChain, setCanPushChain] = useState<boolean | null>(null);
  const contract = activeMintContract();

  useEffect(() => {
    if (!contract) return setCanPushChain(false);
    readContractState(contract)
      .then((s) => setCanPushChain(s.contractURI != null)) // CloneForge yes · ICloneAgent no
      .catch(() => setCanPushChain(false));
  }, [contract]);

  function saveLocal() {
    setAlias(coll.key, name === coll.key ? "" : name);
    toast("Collection renamed in your Vault", "ok");
    onClose();
  }

  async function saveAndPush() {
    if (!name.trim()) return toast("Give it a name", "err");
    if (!store.irys || !w.connected) return toast("Connect your wallet first", "err");
    setBusy(true);
    try {
      // 1 · new profile JSON sealed on Irys
      const p = forge.profile;
      const json = {
        name: name.trim(),
        description: p.description || undefined,
        external_link: p.externalLink || undefined,
        image: p.imageUrl || coll.covers[0] || undefined,
      };
      const tags: Tag[] = [
        { name: "App-Name", value: "iIrys Frame" },
        { name: "Type", value: "collection-profile" },
        { name: "Name", value: `${name.trim()} — collection profile` },
        { name: "Collection", value: coll.key },
      ];
      const out = await uploadData(store.irys, new TextEncoder().encode(JSON.stringify(json, null, 2)), "application/json", tags);
      patchProfile({ sealedUri: out.url, name: name.trim() });
      // 2 · point the contract's contractURI at it (OpenSea reads it on refresh)
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet provider unavailable");
      await adminCall(provider, contract!, { fn: "setContractURI", args: [out.url] });
      setAlias(coll.key, name === coll.key ? "" : name);
      toast("Renamed — OpenSea updates after a metadata refresh", "ok");
      onClose();
    } catch (e) {
      toast(`Rename on-chain failed: ${errMsg(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3>Rename collection</h3>
      <p className="modal__sub">
        The Irys tags are permanent, so the Vault shows your display name instantly.
        {canPushChain
          ? " Your contract supports contractURI — pushing the new name on-chain updates the OpenSea collection page too."
          : " Your current contract has no contractURI: on OpenSea, edit the collection name in OpenSea Studio (it comes from the contract)."}
      </p>
      <div className="field">
        <label>Collection name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="modal__actions">
        <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={saveLocal} disabled={busy}>
          Save in Vault
        </button>
        {canPushChain && (
          <button className="btn btn--primary" onClick={saveAndPush} disabled={busy || !w.connected}>
            {busy ? "Updating…" : "Save + update OpenSea"}
          </button>
        )}
      </div>
    </Modal>
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
        <p>
          {!connected
            ? "Connect your wallet to load your on-chain inventory."
            : loading
              ? "Loading your vault…"
              : "No collections yet. Seal layers in 2D NFT to get started."}
        </p>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="empty">
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
  // when a pre-mint repair runs, mint the marketplace-ready metadata instead
  const [mintUri, setMintUri] = useState<string | null>(null);

  async function doMint() {
    if (!it.metadata) return;
    if (!w.connected || !w.address) return toast("Connect your wallet first", "err");
    setMinting(true);
    try {
      if (!w.onBase) await w.switchToBase();
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet unavailable — reconnect.");
      const hash = await mint(provider, w.address, mintUri ?? it.metadata.url);
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
        <span>Mint link (tokenURI)</span>
        {it.metadata ? <CopyField value={it.metadata.url} /> : <code>metadata not sealed yet</code>}
      </div>

      {it.metadata && canMint() && (
        <div className="dd__row">
          <button className="btn btn--primary btn--block" onClick={doMint} disabled={minting || !w.connected}>
            {minting ? "Minting…" : !w.connected ? "Connect wallet to mint" : "Mint on Base"}
          </button>
          {txHash ? (
            <a className="dd__txlink" href={`${BASE.explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
              View transaction on Basescan
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

      {it.metadata && mintUri && (
        <div className="dd__row">
          <span className="dd__minthint">Marketplace-ready metadata prepared — “Mint on Base” will mint the repaired version.</span>
        </div>
      )}
      {it.metadata && <MediaRepair metadataId={it.metadata.id} onRepaired={setMintUri} />}

      <div className="dd__row">
        <span>Item id</span>
        <code>{it.item}</code>
      </div>
    </>
  );
}

/** Fix blank media on OpenSea: re-seal this item's metadata with direct CDN
 *  media links (the gateway's no-store 302 breaks marketplace crawlers) and
 *  point the minted token at it via setTokenURI. Owner-only, ~free. */
function MediaRepair({ metadataId, onRepaired }: { metadataId: string; onRepaired?: (uri: string) => void }) {
  const w = useWallet();
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const contract = activeMintContract();

  async function repair() {
    if (!contract) return toast("No mint contract configured", "err");
    if (!w.connected || !store.irys) return toast("Connect your wallet first", "err");
    setBusy(true);
    try {
      setStep("Finding every minted token of this item…");
      const { findTokensForMetadata, repairAllTokens, repairUnminted } = await import("../forge/repair");
      const tokenIds = await findTokensForMetadata(contract, metadataId);
      if (tokenIds.length === 0) {
        // sealed but not minted — prepare the marketplace-ready metadata NOW,
        // so "Mint on Base" mints the fixed version (no setTokenURI needed)
        const out = await repairUnminted({ irys: store.irys, uploadData, metadataId, onStep: setStep });
        onRepaired?.(out.uri);
        setDone(`Not minted yet — metadata repaired (${out.detail}). Hit "Mint on Base" above to mint the marketplace-ready version.`);
        toast("Repaired — ready to mint", "ok");
        return;
      }

      const { makeUploader } = await import("../irys");
      const getFresh = async () => {
        const provider = await w.getProvider();
        if (!provider) throw new Error("Wallet provider unavailable — reconnect the wallet");
        return { provider, irys: await makeUploader(provider) };
      };
      // the full engine, applied to EVERY token minted from this item
      // (duplicate mints — e.g. two Titans — get fixed in the same run)
      const results = await repairAllTokens({
        getFresh,
        uploadData,
        contract,
        only: tokenIds,
        onStep: setStep,
      });
      if (results.length === 0) throw new Error("Tokens not reachable");
      const lines = results.map((r) => `#${r.tokenId} ${r.status}${r.detail ? ` (${r.detail})` : ""}`).join(" · ");
      const anyError = results.some((r) => r.status === "error");
      setDone(`${lines}. On OpenSea, hit "Refresh metadata" on each token.`);
      toast(
        anyError
          ? "Repair finished with errors — see details"
          : `Repaired ${results.filter((r) => r.status === "repaired").length}/${tokenIds.length} token(s)`,
        anyError ? "err" : "ok",
      );
    } catch (e) {
      toast(`Repair failed: ${errMsg(e)}`, "err");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  async function recenter() {
    if (!contract) return toast("No mint contract configured", "err");
    if (!w.connected || !store.irys) return toast("Connect your wallet first", "err");
    setBusy(true);
    try {
      const { recenterFraming } = await import("../forge/repair");
      const { makeUploader } = await import("../irys");
      const getFresh = async () => {
        const provider = await w.getProvider();
        if (!provider) throw new Error("Wallet provider unavailable — reconnect the wallet");
        return { provider, irys: await makeUploader(provider) };
      };
      const results = await recenterFraming({ getFresh, uploadData, contract, metadataId, onStep: setStep });
      if (results.length === 0) throw new Error("Tokens not reachable");
      const lines = results.map((r) => `#${r.tokenId} ${r.status}${r.detail ? ` (${r.detail})` : ""}`).join(" · ");
      const anyError = results.some((r) => r.status === "error");
      setDone(`${lines}. On OpenSea, hit "Refresh metadata" on each token — the figure centers in the pane.`);
      toast(anyError ? "Recenter finished with errors — see details" : `Recentered ${results.filter((r) => r.status === "repaired").length} token(s)`, anyError ? "err" : "ok");
    } catch (e) {
      toast(`Recenter failed: ${errMsg(e)}`, "err");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  async function reframe(file: File) {
    if (!contract) return toast("No mint contract configured", "err");
    if (!w.connected || !store.irys) return toast("Connect your wallet first", "err");
    setBusy(true);
    try {
      const { repairWithNewModel } = await import("../forge/repair");
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet provider unavailable");
      const out = await repairWithNewModel({ provider, irys: store.irys, uploadData, contract, metadataId, file, onStep: setStep });
      setDone(`Token #${out.tokenId} re-framed from ${file.name} — hit "Refresh metadata" on OpenSea and the figure centers correctly.`);
      toast(`Token #${out.tokenId} re-framed`, "ok");
    } catch (e) {
      toast(`Reframe failed: ${errMsg(e)}`, "err");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  if (done) return <div className="dd__row"><span>Marketplace media</span><span className="dd__minthint">{done}</span></div>;
  return (
    <div className="dd__row">
      <span>Marketplace media</span>
      <button className="btn btn--mini" onClick={repair} disabled={busy || !w.connected}>
        {busy ? step || "Repairing…" : "Repair OpenSea media (re-seal + setTokenURI)"}
      </button>
      <button className="btn btn--ghost btn--mini" onClick={recenter} disabled={busy || !w.connected}>
        {busy ? step || "…" : "Recenter framing (fix off-center on OpenSea)"}
      </button>
      <label className="btn btn--ghost btn--mini" style={{ cursor: "pointer", textAlign: "center" }}>
        {busy ? "…" : "Fix 3D framing (re-export from original file)"}
        <input type="file" accept=".fbx,.glb,.gltf,.obj" hidden disabled={busy || !w.connected}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void reframe(f); e.target.value = ""; }} />
      </label>
      <span className="dd__minthint">
        Use this if OpenSea shows the item blank: the Irys gateway redirects with no-store, which marketplace crawlers
        refuse to cache. This re-seals the metadata with direct, cacheable media links and re-points the minted token.
      </span>
    </div>
  );
}
