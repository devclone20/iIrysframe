import { useEffect, useState } from "react";
import type { Tab } from "../App";
import { useWallet } from "../wallet";
import { useStore } from "../store";
import { BASE } from "../config";
import { shortAddr, addrGradient, fmtEth, usdOf, fmtUsd } from "../format";
import { copy, confirmDialog, toast, errMsg } from "../ui";
import { fund, withdrawAll } from "../irys";

const TABS: { key: Tab; label: string }[] = [
  { key: "soul", label: "Soul" },
  { key: "engine", label: "Engine" },
  { key: "iirys", label: "iIrys" },
  { key: "vault", label: "Vault" },
  { key: "swap", label: "Swap" },
  { key: "contracts", label: "Contracts" },
];

export function TopBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const w = useWallet();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <path d="M16 5 L26 10.5 V21.5 L16 27 L6 21.5 V10.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <circle cx="16" cy="16" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M16 12.6 V9.2 M16 19.4 V22.8 M12.6 16 H9.2 M19.4 16 H22.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <div className="brand__text">
          <strong>iIrys Frame</strong>
          <span>NFT layer vault · Irys × Base</span>
        </div>
      </div>

      <nav className="tabs tabs--6" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "is-active" : ""}`} onClick={() => onTab(t.key)} role="tab">
            {t.label}
          </button>
        ))}
        <span
          className="tabs__thumb"
          aria-hidden="true"
          style={{ width: `calc((100% - 8px) / ${TABS.length})`, transform: `translateX(${TABS.findIndex((t) => t.key === tab) * 100}%)` }}
        />
      </nav>

      <div className="topbar__right">
        {w.connected && (
          <span className={`net-pill ${w.onBase ? "" : "is-wrong"}`} onClick={() => !w.onBase && w.switchToBase()}>
            <span className="net-pill__dot" />
            {w.onBase ? "Base" : "Switch"}
          </span>
        )}
        <WalletButton />
      </div>
    </header>
  );
}

function WalletButton() {
  const w = useWallet();
  const store = useStore();
  const [open, setOpen] = useState(false);

  if (!w.connected) {
    return (
      <button className="btn btn--primary" onClick={() => w.login()} disabled={w.available && !w.ready}>
        Connect wallet
      </button>
    );
  }
  return (
    <div className="wallet-wrap">
      <button className="wallet" onClick={() => setOpen((o) => !o)}>
        <span className="wallet__ident" style={{ background: addrGradient(w.address) }} />
        <div className="wallet__meta">
          <span className="wallet__addr">{shortAddr(w.address)}</span>
          <span className="wallet__bal">
            {fmtEth(store.baseEth)} ETH
            {usdOf(store.baseEth, store.ethUsd) && <em className="wallet__usd"> · {usdOf(store.baseEth, store.ethUsd)}</em>}
          </span>
        </div>
        <span className="wallet__chev">⌄</span>
      </button>
      {open && <WalletPanel onClose={() => setOpen(false)} />}
    </div>
  );
}

function WalletPanel({ onClose }: { onClose: () => void }) {
  const w = useWallet();
  const store = useStore();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void store.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fundIrys() {
    if (!store.irys) return toast("Wallet not ready yet", "err");
    if (!w.onBase) return toast("Switch to Base first", "err");
    const eth = Number.parseFloat(amount);
    if (!(eth > 0)) return toast("Enter an ETH amount (e.g. 0.001)", "err");
    const usd = usdOf(eth, store.ethUsd);
    const ok = await confirmDialog(
      "Fund Irys account",
      `Transfer <strong>${eth} ETH${usd ? ` (≈ ${usd})` : ""}</strong> on Base into your Irys storage credit. This is an on-chain transaction from your wallet.`,
      "Fund",
    );
    if (!ok) return;
    setBusy(true);
    try {
      const provider = await w.getProvider();
      if (!provider) return toast("Wallet provider unavailable — reconnect the wallet", "err");
      await fund(store.irys, eth, provider);
      toast(`Irys account funded with ${eth} ETH`, "ok");
      setAmount("");
      await store.refresh();
    } catch (e) {
      toast(`Fund failed: ${errMsg(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawIrys() {
    if (!store.irys) return toast("Wallet not ready yet", "err");
    const usd = usdOf(store.nodeEth, store.ethUsd);
    const ok = await confirmDialog(
      "Withdraw Irys credit",
      `Withdraw your unused Irys credit (<strong>${fmtEth(store.nodeEth)} ETH${usd ? ` ≈ ${usd}` : ""}</strong>) back to your wallet on Base.`,
      "Withdraw all",
    );
    if (!ok) return;
    setBusy(true);
    try {
      await withdrawAll(store.irys);
      toast("Irys credit withdrawn to your wallet", "ok");
      await store.refresh();
    } catch (e) {
      toast(`Withdraw failed: ${errMsg(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  const hasCredit = Number.parseFloat(store.nodeEth ?? "0") > 0;

  return (
    <>
      <div className="pop-scrim" onClick={onClose} />
      <div className="wallet-pop">
        <div className="wp__head">
          <span className="wp__ident" style={{ background: addrGradient(w.address) }} />
          <div className="wp__id">
            <div className="wp__addr">{shortAddr(w.address)}</div>
            <div className="wp__type">{w.email ?? w.walletType ?? "wallet"}</div>
          </div>
        </div>

        <div className="wp__actions">
          <button className="btn btn--ghost btn--mini" onClick={() => copy(w.address!, "Address copied")}>
            Copy address
          </button>
          <a className="btn btn--ghost btn--mini" href={`${BASE.explorer}/address/${w.address}`} target="_blank" rel="noopener noreferrer">
            Basescan ↗
          </a>
        </div>

        <div className={`wp__net ${w.onBase ? "" : "is-wrong"}`}>
          <span>Network</span>
          {w.onBase ? (
            <strong>Base · 8453</strong>
          ) : (
            <button className="btn btn--mini" onClick={() => w.switchToBase().then(() => store.refresh())}>
              Switch to Base
            </button>
          )}
        </div>

        <div className="wp__bals">
          <div className="wp__bal">
            <span>Base wallet</span>
            <strong>{fmtEth(store.baseEth)}</strong>
            <em>ETH</em>
            {usdOf(store.baseEth, store.ethUsd) && <span className="wp__bal-usd">≈ {usdOf(store.baseEth, store.ethUsd)}</span>}
          </div>
          <div className="wp__bal">
            <span>Irys credit</span>
            <strong>{fmtEth(store.nodeEth)}</strong>
            <em>storage</em>
            {usdOf(store.nodeEth, store.ethUsd) && <span className="wp__bal-usd">≈ {usdOf(store.nodeEth, store.ethUsd)}</span>}
          </div>
        </div>

        <div className="wp__fund">
          <span className="wp__fund-label">
            Fund Irys credit (Base ETH)
            {usdOf(amount, store.ethUsd) && <em className="wp__fund-usd">≈ {usdOf(amount, store.ethUsd)}</em>}
          </span>
          <div className="wp__fund-row">
            <input
              type="number"
              step="0.001"
              min="0"
              placeholder="0.001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button className="btn btn--primary btn--mini" onClick={fundIrys} disabled={busy}>
              {busy ? "Funding…" : "Fund"}
            </button>
          </div>
          <span className="wp__fund-hint">
            Only needed for uploads ≥100 KiB — smaller is free.
            {store.ethUsd && <span className="wp__rate"> · ETH {fmtUsd(store.ethUsd)}</span>}
          </span>
          <button className="wp__withdraw" onClick={withdrawIrys} disabled={busy || !hasCredit}>
            ↩ Withdraw unused credit
          </button>
        </div>

        <button className="btn btn--ghost btn--mini wp__refresh" onClick={() => store.refresh()}>
          ⟳ Refresh balances
        </button>
        <button
          className="btn btn--block"
          onClick={async () => {
            await w.logout();
            onClose();
          }}
        >
          Disconnect
        </button>
      </div>
    </>
  );
}
