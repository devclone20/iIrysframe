import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { useWizard } from "../wizard/wizardStore";
import { useForge, patchProfile, itemEditionLimit } from "../forge/forgeStore";
import { readContractState, adminCall, parseEthOrZero, type ContractState } from "../forge/deploy";
import { useWallet } from "../wallet";
import { useStore } from "../store";
import { uploadData } from "../irys";
import { toast, errMsg, confirmDialog, CopyField } from "../ui";
import { BASE, chainInfo, type Tag, type Eip1193Provider } from "../config";
import { feeOverridesFor } from "../mint";

const MINT_ABI = [
  "function mint(address to, string uri) payable returns (uint256)",
  "function mintDrop(uint256 quantity) payable",
];

/** Irys tx id of a sealed metadata URL (last path segment survives /mutable/). */
const metaIdOf = (url: string): string => url.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() ?? url;

async function ownerMint(provider: Eip1193Provider, contract: string, to: string, uri: string, chainId: number): Promise<string> {
  const chain = chainInfo(chainId);
  const bp = new ethers.BrowserProvider(provider as any);
  const net = await bp.getNetwork();
  if (Number(net.chainId) !== chain.id) throw new Error(`Switch the wallet to ${chain.name} first`);
  const signer = await bp.getSigner();
  const c = new ethers.Contract(contract, MINT_ABI, signer);
  const overrides = await feeOverridesFor(bp, chain.id);
  const tx = await (c as any).mint(to, uri, overrides);
  await tx.wait();
  return tx.hash as string;
}

async function ownerMintDrop(provider: Eip1193Provider, contract: string, qty: number, chainId: number): Promise<string> {
  const chain = chainInfo(chainId);
  const bp = new ethers.BrowserProvider(provider as any);
  const net = await bp.getNetwork();
  if (Number(net.chainId) !== chain.id) throw new Error(`Switch the wallet to ${chain.name} first`);
  const signer = await bp.getSigner();
  const c = new ethers.Contract(contract, MINT_ABI, signer);
  const overrides = await feeOverridesFor(bp, chain.id);
  const tx = await (c as any).mintDrop(qty, overrides);
  await tx.wait();
  return tx.hash as string;
}

export function Launch({ goCreate }: { goCreate: () => void }) {
  const wiz = useWizard();
  const forge = useForge();
  const w = useWallet();
  const store = useStore();

  const sealed = wiz.items.filter((i) => i.status === "sealed" && i.sealed);
  const contract = forge.active ?? forge.deployed[0]?.address ?? (import.meta.env.VITE_MINT_CONTRACT as string | undefined)?.trim() ?? null;
  const chainId = forge.deployed.find((d) => d.address.toLowerCase() === contract?.toLowerCase())?.chainId ?? BASE.id;
  const chain = chainInfo(chainId);
  const [state, setState] = useState<ContractState | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintStep, setMintStep] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!contract) return;
    readContractState(contract, chainId).then(setState).catch(() => setState(null));
  }, [contract, chainId, minting]);

  useEffect(() => {
    if (!contract || sealed.length === 0 || minting) return;
    let alive = true;
    (async () => {
      const { mintedCountFor } = await import("../forge/repair");
      for (const it of sealed) {
        if (!alive) return;
        const metaId = metaIdOf(it.sealed!.metadata);
        try {
          const n = await mintedCountFor(contract, metaId, chainId);
          if (alive) setCounts((c) => (c[metaId] === n ? c : { ...c, [metaId]: n }));
        } catch {
          /* fail open — the row keeps its Mint button */
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract, chainId, minting, sealed.length]);

  const manifestWired = !!state?.dropBaseURI && !!wiz.sealBaseURI && state.dropBaseURI === wiz.sealBaseURI;
  const canDropMint = manifestWired && sealed.length > 0;

  async function refresh() {
    if (contract) setState(await readContractState(contract, chainId).catch(() => null));
  }

  /** Put the wallet on the contract's chain before any tx. */
  async function ensureChain(): Promise<boolean> {
    if (w.chainId === chainId) return true;
    try {
      await w.switchTo(chainId);
      return true;
    } catch {
      toast(`Couldn't switch the wallet to ${chain.name} — switch it manually and retry`, "err");
      return false;
    }
  }

  async function mintAll() {
    if (!contract) return toast("Deploy a contract first (Create → Contract)", "err");
    if (!w.connected || !w.address) return toast("Connect your wallet first", "err");
    if (!(await ensureChain())) return;
    const provider = await w.getProvider();
    if (!provider) return toast("Wallet provider unavailable", "err");

    if (canDropMint) {
      const ok = await confirmDialog(
        "Mint the whole collection",
        `Mint <strong>all ${sealed.length} items</strong> in <strong>one transaction</strong> (sequential ids from your sealed manifest) to your wallet. You pay one gas fee. OpenSea indexes them minutes later.`,
        "Mint all",
      );
      if (!ok) return;
      setMinting(true);
      try {
        setMintStep("Minting collection…");
        const hash = await ownerMintDrop(provider, contract, sealed.length, chainId);
        toast(`Collection minted — ${hash.slice(0, 14)}…`, "ok");
      } catch (e) {
        toast(`Mint failed: ${errMsg(e)}`, "err");
      } finally {
        setMinting(false);
        setMintStep("");
      }
      return;
    }

    // fallback: one tx per item (works on any contract with mint(address,string))
    const ok = await confirmDialog(
      "Mint the whole collection",
      `Mint <strong>${sealed.length} items</strong> — one transaction per item (your wallet will ask ${sealed.length} times). Items whose editions are already fully minted are skipped. Tip: wire the drop manifest below to mint everything in a single transaction instead.`,
      "Mint one by one",
    );
    if (!ok) return;
    setMinting(true);
    try {
      const { mintedCountFor, invalidateMintedCount } = await import("../forge/repair");
      let done = 0;
      let skipped = 0;
      for (const it of sealed) {
        const metaId = metaIdOf(it.sealed!.metadata);
        setMintStep(`Checking editions of ${it.name}…`);
        let count: number | null = null;
        try {
          count = await mintedCountFor(contract, metaId, chainId);
        } catch {
          /* fail open — the limit is a guard, not consensus */
        }
        if (count != null && count >= itemEditionLimit(metaId)) {
          skipped++;
          continue;
        }
        setMintStep(`Minting ${it.name} (${done + 1}/${sealed.length})…`);
        await ownerMint(provider, contract, w.address, it.sealed!.metadata, chainId);
        invalidateMintedCount(contract, metaId);
        done++;
      }
      toast(`Minted ${done}/${sealed.length}${skipped ? ` · skipped ${skipped} (editions exhausted)` : ""}`, "ok");
    } catch (e) {
      toast(`Stopped: ${errMsg(e)}`, "err");
    } finally {
      setMinting(false);
      setMintStep("");
      void refresh();
    }
  }

  async function mintOne(uri: string, name: string) {
    if (!contract) return toast("Deploy a contract first", "err");
    if (!w.connected || !w.address) return toast("Connect your wallet first", "err");
    if (!(await ensureChain())) return;
    const provider = await w.getProvider();
    if (!provider) return toast("Wallet provider unavailable", "err");
    setMinting(true);
    try {
      const { mintedCountFor, invalidateMintedCount } = await import("../forge/repair");
      const metaId = metaIdOf(uri);
      const limit = itemEditionLimit(metaId);
      setMintStep(`Checking editions of ${name}…`);
      let count: number | null = null;
      try {
        count = await mintedCountFor(contract, metaId, chainId);
      } catch {
        toast("Edition check failed — minting anyway", "err");
      }
      if (count != null && count >= limit) {
        const n = count;
        setCounts((c) => ({ ...c, [metaId]: n }));
        return toast(`${name}: all ${limit} edition${limit === 1 ? "" : "s"} minted`, "err");
      }
      setMintStep(`Minting ${name}…`);
      const hash = await ownerMint(provider, contract, w.address, uri, chainId);
      invalidateMintedCount(contract, metaId);
      toast(`Minted ${name} — ${hash.slice(0, 12)}…`, "ok");
    } catch (e) {
      toast(`Mint failed: ${errMsg(e)}`, "err");
    } finally {
      setMinting(false);
      setMintStep("");
    }
  }

  async function admin(action: Parameters<typeof adminCall>[2], label: string) {
    if (!contract) return;
    try {
      if (!(await ensureChain())) return;
      const provider = await w.getProvider();
      if (!provider) return toast("Connect the wallet first", "err");
      await adminCall(provider, contract, action, chainId);
      toast(`${label} — done`, "ok");
      void refresh();
    } catch (e) {
      toast(`${label} failed: ${errMsg(e)}`, "err");
    }
  }

  // collection profile → contractURI (for OpenSea page)
  const [profileSealing, setProfileSealing] = useState(false);
  async function sealProfile() {
    if (!store.irys) return toast("Connect your wallet first", "err");
    setProfileSealing(true);
    try {
      const p = forge.profile;
      const firstImage = sealed[0]?.sealed?.image ?? "";
      const json = {
        name: wiz.naming.collection || p.name,
        description: wiz.description || p.description,
        external_link: p.externalLink || undefined,
        image: p.imageUrl || firstImage || undefined,
      };
      const tags: Tag[] = [
        { name: "App-Name", value: "iIrys Frame" },
        { name: "Type", value: "collection-profile" },
        { name: "Name", value: `${json.name} — collection profile` },
        { name: "Collection", value: json.name },
      ];
      const out = await uploadData(store.irys, new TextEncoder().encode(JSON.stringify(json, null, 2)), "application/json", tags);
      patchProfile({ sealedUri: out.url, name: json.name });
      toast("Collection profile sealed", "ok");
    } catch (e) {
      toast(`Seal failed: ${errMsg(e)}`, "err");
    } finally {
      setProfileSealing(false);
    }
  }

  if (sealed.length === 0) {
    return (
      <section className="view">
        <div className="empty" style={{ paddingTop: 80 }}>
          <p>
            Nothing sealed yet. Build your collection in <strong>Create</strong> — when it's sealed on Irys it lands here,
            ready to mint and launch.
          </p>
          <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={goCreate}>
            Open Create
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="rail">
        <Stat label="Collection" value={wiz.naming.collection || "—"} sub={`${sealed.length} sealed items`} />
        <Stat label="Contract" value={contract ? `${contract.slice(0, 6)}…${contract.slice(-4)}` : "—"} sub={contract ? `${state?.symbol ? `${state.symbol} · ` : ""}${chain.name}` : "deploy in Create"} />
        <Stat label="Minted" value={state?.totalMinted != null ? String(state.totalMinted) : "—"} sub={state?.maxSupply != null && state.maxSupply !== 0n ? `of ${state.maxSupply}` : "on-chain"} />
        <Stat label="Public mint" value={state?.publicMint == null ? "—" : state.publicMint ? "ON" : "off"} sub={state?.mintPriceEth ? `${state.mintPriceEth} ETH` : "owner only"} />
      </div>

      <div className="forge">
        <div className="forge__col">
          <article className="panel">
            <header className="panel__head">
              <h2>Mint</h2>
              {mintStep && <span className="panel__hint">{mintStep}</span>}
            </header>
            <p className="folder-legend">
              {canDropMint
                ? "Manifest wired — the whole collection mints in one transaction, one gas fee."
                : "Mint item by item, or wire the drop manifest (below) to mint everything in a single transaction."}
            </p>
            <button className="btn btn--primary btn--block" disabled={minting || !contract || !w.connected} onClick={mintAll}>
              {minting ? mintStep || "Minting…" : `Mint the whole collection (${sealed.length})`}
            </button>

            {contract && state && (
              <div className="forge__admin">
                <span className="e3d__attrs-head"><span>Public mint & controls</span></span>
                <div className="irys-actions" style={{ justifyContent: "flex-start" }}>
                  <button className="btn btn--mini" onClick={() => admin({ fn: "setPublicMint", args: [!(state.publicMint ?? false)] }, "Public mint")}>
                    {state.publicMint ? "Close public mint" : "Open public mint"}
                  </button>
                  <button className="btn btn--mini" onClick={() => admin({ fn: "setMintPrice", args: [parseEthOrZero(forge.drop.priceEth)] }, "Price")}>
                    Set price {forge.drop.priceEth || "0"} ETH
                  </button>
                  {wiz.sealBaseURI && !manifestWired && state.dropBaseURI != null && (
                    <button className="btn btn--mini" onClick={() => admin({ fn: "setDropBaseURI", args: [wiz.sealBaseURI!] }, "Wire manifest")}>
                      Wire drop manifest
                    </button>
                  )}
                  {forge.profile.sealedUri && state.contractURI != null && state.contractURI !== forge.profile.sealedUri && (
                    <button className="btn btn--mini" onClick={() => admin({ fn: "setContractURI", args: [forge.profile.sealedUri!] }, "contractURI")}>
                      Set contractURI
                    </button>
                  )}
                  <button className="btn btn--ghost btn--mini" onClick={() => admin({ fn: "withdraw", args: [w.address ?? ""] }, "Withdraw")}>
                    Withdraw proceeds
                  </button>
                </div>
              </div>
            )}
          </article>

          <article className="panel">
            <header className="panel__head"><h2>OpenSea</h2></header>
            <p className="folder-legend">
              {wiz.launch === "opensea-console"
                ? "Your launch runs through OpenSea's console — this is the exact data it needs."
                : "After minting, the collection appears on OpenSea automatically. Seal the profile so the page arrives pre-filled."}
            </p>
            <button className="btn btn--block" disabled={profileSealing || !w.connected} onClick={sealProfile}>
              {profileSealing ? "Sealing…" : forge.profile.sealedUri ? "Re-seal collection profile" : "Seal collection profile (contractURI)"}
            </button>
            {forge.profile.sealedUri && <CopyField value={forge.profile.sealedUri} />}
            {wiz.sealBaseURI && (
              <>
                <label className="wizard__sub">Drop manifest (tokenURI base)</label>
                <CopyField value={wiz.sealBaseURI} />
              </>
            )}
            {contract && (
              <>
                <label className="wizard__sub">Contract</label>
                <CopyField value={contract} />
              </>
            )}
            <ol className="forge__ol" style={{ marginTop: 12 }}>
              <li>Mint (or open public mint) — OpenSea indexes Base mints in minutes.</li>
              <li>OpenSea Studio → your collection → confirm banner, description and earnings (pre-filled from contractURI + ERC-2981).</li>
              <li>OG-gated drops: the contract enforces the gate; announce the requirement on the drop page.</li>
              <li>Console drops: paste the manifest base + contract address into OpenSea's drop console fields.</li>
            </ol>

            <span className="e3d__attrs-head" style={{ marginTop: 14 }}><span>OpenSea asset sizes (official)</span></span>
            <div className="irys-summary">
              <div className="irys-row"><span>Item image</span><strong>1:1 square · 3000×3000 recommended</strong></div>
              <div className="irys-row"><span>Collection logo</span><strong>1:1 · 350×350+</strong></div>
              <div className="irys-row"><span>Banner</span><strong>4:1 · 1400×350+ · under 1 MB</strong></div>
              <div className="irys-row"><span>Featured image</span><strong>3:2 · 600×400+ · under 1 MB</strong></div>
            </div>
            <p className="e3d__soulhint">
              Posters sealed here are square (1:1) by design. In Studio → Display mode, pick “Covered” for edge-to-edge
              square art. Logo/banner/featured upload directly in Studio.
            </p>

            <RepairAllMedia contract={contract} />
          </article>
        </div>

        <div className="forge__col">
          <article className="panel">
            <header className="panel__head">
              <h2>{wiz.naming.collection || "Collection"}</h2>
              <span className="panel__hint">{sealed.length} items · sealed forever</span>
            </header>
            <div className="wizard__grid">
              {sealed.map((b) => {
                const metaId = metaIdOf(b.sealed!.metadata);
                const limit = itemEditionLimit(metaId);
                const count = counts[metaId];
                const exhausted = count != null && count >= limit;
                return (
                  <div className="wizitem is-sealed" key={b.id}>
                    <div className="wizitem__media">{b.posterUrl ? <img src={b.posterUrl} alt="" /> : b.sealed?.image ? <img src={b.sealed.image} alt="" /> : <span className="wizitem__ph">sealed</span>}</div>
                    <div className="wizitem__foot">
                      <span className="wizitem__name">{b.name}</span>
                      {b.tier && <span className="batch__tier">{b.tier}</span>}
                    </div>
                    <div className="irys-actions" style={{ justifyContent: "flex-start", marginTop: 6 }}>
                      {exhausted ? (
                        <span className="batch__sub">{count}/{limit} minted</span>
                      ) : (
                        <button className="btn btn--mini" disabled={minting || !contract} onClick={() => mintOne(b.sealed!.metadata, b.name)}>
                          Mint
                        </button>
                      )}
                      <button className="btn btn--ghost btn--mini" onClick={() => { void navigator.clipboard.writeText(b.sealed!.metadata); toast("Mint link copied", "ok"); }}>
                        Copy link
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </div>
      </div>
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

/** Bulk marketplace-media repair: re-seals every minted token's metadata with
 *  direct, cacheable media links and re-points each tokenURI. One approval
 *  sequence — uploads are free (<100 KiB), each setTokenURI is a cheap tx. */
function RepairAllMedia({ contract }: { contract: string | null }) {
  const w = useWallet();
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [report, setReport] = useState<{ tokenId: number; name: string; status: string; detail?: string }[] | null>(null);

  async function run() {
    if (!contract) return toast("No contract active", "err");
    if (!w.connected || !store.irys) return toast("Connect your wallet first", "err");
    const ok = await confirmDialog(
      "Repair marketplace media",
      "Re-seal the metadata of <strong>every minted token</strong> with direct, cacheable media links (fixes blank images on OpenSea) and re-point each tokenURI. Your wallet will ask to approve one upload signature and one transaction per token.",
      "Repair all",
    );
    if (!ok) return;
    setBusy(true);
    setReport(null);
    try {
      const { repairAllTokens } = await import("../forge/repair");
      const { uploadData, makeUploader } = await import("../irys");
      const getFresh = async () => {
        const provider = await w.getProvider();
        if (!provider) throw new Error("Wallet provider unavailable — reconnect the wallet");
        return { provider, irys: await makeUploader(provider) };
      };
      const results = await repairAllTokens({ getFresh, uploadData, contract, onStep: setStep });
      setReport(results);
      const fixed = results.filter((r) => r.status === "repaired").length;
      toast(`Media repair: ${fixed} token${fixed === 1 ? "" : "s"} repaired`, fixed > 0 ? "ok" : "err");
    } catch (e) {
      toast(`Repair failed: ${errMsg(e)}`, "err");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <div className="forge__admin">
      <span className="e3d__attrs-head"><span>Marketplace media repair</span></span>
      <p className="folder-legend">
        OpenSea showing blank images? The Irys gateway redirects with <code>no-store</code>, which media crawlers refuse
        to cache. This rewrites every minted token to direct, cacheable links — then hit Refresh metadata on OpenSea.
      </p>
      {step && <p className="e3d__seal-meta">{step}</p>}
      <button className="btn btn--block" disabled={busy || !contract || !w.connected} onClick={run}>
        {busy ? step || "Repairing…" : "Repair media on every minted token"}
      </button>
      {report && (
        <div className="batch" style={{ marginTop: 10 }}>
          {report.map((r) => (
            <div className={`batch__row is-${r.status === "repaired" ? "sealed" : r.status === "error" ? "error" : "ready"}`} key={r.tokenId}>
              <span className="batch__idx">{r.tokenId}</span>
              <span className="batch__thumb" />
              <div className="batch__meta">
                <span className="batch__name">{r.name}</span>
                {r.detail && <span className="batch__sub">{r.detail}</span>}
              </div>
              <span className={`batch__status is-${r.status === "repaired" ? "sealed" : r.status}`}>{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
