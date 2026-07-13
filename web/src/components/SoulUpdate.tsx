import { useState } from "react";
import { useWallet } from "../wallet";
import { makeUploader, uploadData } from "../irys";
import { GATEWAY, FREE_THRESHOLD, type Tag } from "../config";
import { toast, errMsg, CopyField } from "../ui";

// Soul Update — refine your iNFT's soul on its mutable Irys anchor.
//
// An "update" is a new upload of the metadata JSON, tagged `Root-TX <rootTx>`
// and signed by the SAME wallet that sealed the original. The gateway then
// serves the newest tx in that owner's chain. A different wallet is ignored by
// the gateway, so we guard on the root owner and only let the owner sign.

const GQL = "https://uploader.irys.xyz/graphql";

type Loaded = {
  rootTx: string;
  owner: string; // lowercase
  meta: any; // the full ERC-721 metadata object
  origTags: Tag[]; // the root tx's tags (minus Content-Type), to preserve grouping
  soul: string; // ai_soul.system_prompt
  personality: string;
};

async function loadFromAnchor(rootTx: string): Promise<Loaded> {
  // metadata: follow the mutable pointer (newest version)
  const mRes = await fetch(`${GATEWAY}/mutable/${rootTx}`);
  if (!mRes.ok) throw new Error(`could not load metadata for ${rootTx} (${mRes.status})`);
  const meta = await mRes.json();

  // owner + original tags: query the ROOT tx (mutability is keyed to it)
  const q = {
    query: `query($id:[String!]!){ transactions(ids:$id){ edges{ node{ address tags{ name value } } } } }`,
    variables: { id: [rootTx] },
  };
  const gRes = await fetch(GQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(q),
  });
  const gJson = await gRes.json();
  const node = gJson?.data?.transactions?.edges?.[0]?.node;
  if (!node) throw new Error("root tx not found on Irys — check the id");
  const owner = String(node.address || "").toLowerCase();
  const origTags: Tag[] = (node.tags || [])
    .filter((t: Tag) => t.name.toLowerCase() !== "content-type" && t.name !== "Root-TX")
    .map((t: Tag) => ({ name: t.name, value: t.value }));

  return {
    rootTx,
    owner,
    meta,
    origTags,
    soul: meta?.ai_soul?.system_prompt ?? "",
    personality: meta?.ai_soul?.personality ?? "",
  };
}

export function SoulUpdate() {
  const w = useWallet();
  const [rootTx, setRootTx] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [soul, setSoul] = useState("");
  const [personality, setPersonality] = useState("");
  const [busy, setBusy] = useState(false);
  const [newTx, setNewTx] = useState<string | null>(null);

  const load = async () => {
    const id = rootTx.trim();
    if (!id) return toast("Paste your NFT's anchor id first", "err");
    setLoading(true);
    setLoaded(null);
    setNewTx(null);
    try {
      const l = await loadFromAnchor(id);
      setLoaded(l);
      setSoul(l.soul);
      setPersonality(l.personality);
      toast("Loaded — this is what the anchor serves now", "ok");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setLoading(false);
    }
  };

  // build the new metadata: same object, refined ai_soul
  const buildMeta = (l: Loaded) => {
    const meta = JSON.parse(JSON.stringify(l.meta));
    meta.ai_soul = { ...(meta.ai_soul || {}) };
    meta.ai_soul.system_prompt = soul;
    if (personality.trim()) meta.ai_soul.personality = personality.trim();
    return meta;
  };

  const bytesOf = (l: Loaded) => new TextEncoder().encode(JSON.stringify(buildMeta(l), null, 2));
  const size = loaded ? bytesOf(loaded).length : 0;
  const free = size < FREE_THRESHOLD;
  const ownerMatch = loaded && w.address && w.address.toLowerCase() === loaded.owner;
  const changed = loaded && (soul !== loaded.soul || personality.trim() !== loaded.personality);

  const sign = async () => {
    if (!loaded) return;
    if (!w.connected) return w.login();
    if (!ownerMatch) return toast("Connect the wallet that owns this NFT", "err");
    setBusy(true);
    setNewTx(null);
    try {
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet provider unavailable — reconnect and try again");

      const irys = await makeUploader(provider);
      if (irys.address && irys.address.toLowerCase() !== loaded.owner) {
        throw new Error(`connected wallet ${irys.address} is not the NFT owner — the update would be ignored`);
      }

      const tags: Tag[] = [{ name: "Root-TX", value: loaded.rootTx }, ...loaded.origTags];
      toast("Approve the signature in your wallet…", "");
      const out = await uploadData(irys, bytesOf(loaded), "application/json", tags);
      setNewTx(out.id);
      // reflect the new baseline so the diff resets
      setLoaded({ ...loaded, meta: buildMeta(loaded), soul, personality: personality.trim() || loaded.personality });
      toast("Soul refined ✓ — the anchor now serves your update", "ok");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="view">
      <article className="panel">
        <header className="panel__head">
          <h2>Soul Update</h2>
          <span className="panel__hint">refine your agent's soul on its living anchor</span>
        </header>

        <p className="folder-legend">
          Your iNFT's soul lives at a <span className="ov">mutable anchor</span> on Irys — a permanent address whose
          pointer only you, the owner, can move. Load your NFT, edit its soul, and sign one signature to publish a new
          version. Every version is kept forever; the anchor just points at the newest. It's free under 100&nbsp;KiB, and
          your original is never lost.
        </p>

        {/* STEP 1 — load */}
        <div className="soul-step">
          <div className="soul-step__n">1 · load your NFT</div>
          <div className="form form--one">
            <div className="field">
              <label>Anchor id <em>(your NFT's root metadata tx — the id in its <code>tokenURI</code>/mutable link)</em></label>
              <input
                value={rootTx}
                onChange={(e) => setRootTx(e.target.value)}
                placeholder="e.g. JCTu7dmsEa327ymLZXpXvvPDv3vi3Vu69kaVddDCoiMZ"
                spellCheck={false}
              />
            </div>
          </div>
          <button className="btn btn--ghost btn--mini" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Load current soul"}
          </button>
        </div>

        {loaded && (
          <>
            <div className="soul-loaded">
              <div>
                <b>{loaded.meta?.name ?? "NFT"}</b>{" "}
                <span className="soul-muted">· owner {loaded.owner.slice(0, 6)}…{loaded.owner.slice(-4)}</span>
              </div>
              <div className="soul-muted">personality: {loaded.personality || "—"}</div>
            </div>

            {/* STEP 2 — edit */}
            <div className="soul-step">
              <div className="soul-step__n">2 · edit the soul</div>
              <div className="form form--one">
                <div className="field">
                  <label>Personality <em>(one line — how your agent presents itself)</em></label>
                  <input value={personality} onChange={(e) => setPersonality(e.target.value)} spellCheck={false} />
                </div>
                <div className="field">
                  <label>Soul <em>(the system prompt that defines who your agent is)</em></label>
                  <textarea
                    className="soul-textarea"
                    value={soul}
                    onChange={(e) => setSoul(e.target.value)}
                    spellCheck={false}
                    rows={14}
                  />
                </div>
              </div>
              <div className="soul-meta">
                {size.toLocaleString()} bytes ·{" "}
                {free ? <span className="ov">free (under 100 KiB)</span> : <b>over 100 KiB — a small fee applies</b>}
                {changed ? "" : " · no changes yet"}
              </div>
            </div>

            {/* STEP 3 — sign */}
            <div className="soul-step">
              <div className="soul-step__n">3 · sign &amp; publish</div>
              {!w.connected ? (
                <button className="btn btn--primary btn--block" onClick={() => w.login()}>
                  Connect your wallet
                </button>
              ) : !ownerMatch ? (
                <div className="soul-warn">
                  Connected wallet <b>{w.address?.slice(0, 6)}…{w.address?.slice(-4)}</b> is not this NFT's owner.
                  Switch to <b>{loaded.owner.slice(0, 6)}…{loaded.owner.slice(-4)}</b> to update its soul.
                </div>
              ) : (
                <button className="btn btn--primary btn--block" onClick={sign} disabled={busy || !changed}>
                  {busy ? "Waiting for your signature…" : changed ? "Sign & publish new soul" : "Edit the soul to enable"}
                </button>
              )}
            </div>

            {newTx && (
              <div className="soul-done">
                <div className="ov">Soul refined — your anchor now serves the new version.</div>
                <div className="soul-muted" style={{ margin: "6px 0" }}>new version tx</div>
                <CopyField value={newTx} />
                <a className="soul-link" href={`${GATEWAY}/mutable/${loaded.rootTx}`} target="_blank" rel="noreferrer">
                  open the living anchor ↗
                </a>
              </div>
            )}
          </>
        )}

        <p className="soul-safety">
          🔒 You only ever approve a <b>signature</b> — never a payment, and never your 12-word secret recovery phrase.
          This page cannot see your keys.
        </p>
      </article>
    </section>
  );
}
