import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "../wallet";
import { useStore } from "../store";
import { BASE_TOKENS, getQuote, executeSwap, resolveToken, type Token, type Quote } from "../swap";
import { BASE } from "../config";
import { fmtEth } from "../format";
import { toast, errMsg } from "../ui";

export function Swap() {
  const w = useWallet();
  const store = useStore();

  const [tokens, setTokens] = useState<Token[]>(BASE_TOKENS);
  const [from, setFrom] = useState<Token>(BASE_TOKENS[0]!);
  const [to, setTo] = useState<Token>(BASE_TOKENS[2]!); // USDC
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [custom, setCustom] = useState("");
  const reqId = useRef(0);

  // debounced quote
  useEffect(() => {
    setQuote(null);
    const amt = Number.parseFloat(amount);
    if (!w.connected || !w.address || !(amt > 0) || from.address === to.address) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const q = await getQuote({ from, to, amount, fromAddress: w.address! });
        if (id === reqId.current) setQuote(q);
      } catch (e) {
        if (id === reqId.current) {
          setQuote(null);
          setStatus(errMsg(e));
        }
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 550);
    return () => clearTimeout(t);
  }, [amount, from, to, w.connected, w.address]);

  const rate = useMemo(() => {
    if (!quote || !(Number(amount) > 0)) return null;
    const r = Number(quote.toAmount) / Number(amount);
    return Number.isFinite(r) ? r : null;
  }, [quote, amount]);

  function flip() {
    setFrom(to);
    setTo(from);
    setAmount("");
    setQuote(null);
  }

  async function addCustom() {
    if (!w.connected) return toast("Connect a wallet first", "err");
    try {
      const provider = await w.getProvider();
      if (!provider) return;
      const tk = await resolveToken(provider, custom.trim());
      if (!tokens.some((t) => t.address.toLowerCase() === tk.address.toLowerCase())) setTokens((p) => [...p, tk]);
      setTo(tk);
      setCustom("");
      toast(`Added ${tk.symbol}`, "ok");
    } catch (e) {
      toast(`Token: ${errMsg(e)}`, "err");
    }
  }

  async function doSwap() {
    if (!quote || !w.address) return;
    setBusy(true);
    setStatus("");
    try {
      const provider = await w.getProvider();
      if (!provider) throw new Error("Wallet provider unavailable.");
      const hash = await executeSwap(provider, quote, setStatus);
      toast(`Swap confirmed: ${hash.slice(0, 10)}…`, "ok");
      setStatus("");
      setAmount("");
      setQuote(null);
      await store.refresh();
    } catch (e) {
      toast(`Swap failed: ${errMsg(e)}`, "err");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const sel = (val: Token, set: (t: Token) => void) => (
    <select
      value={val.address}
      onChange={(e) => set(tokens.find((t) => t.address === e.target.value)!)}
    >
      {tokens.map((t) => (
        <option key={t.address} value={t.address}>
          {t.symbol}
        </option>
      ))}
    </select>
  );

  return (
    <section className="view">
      <article className="panel panel--swap">
        <header className="panel__head">
          <h2>Swap</h2>
          <span className="panel__hint">Base · best route, lowest fee</span>
        </header>

        {/* FROM */}
        <div className="swap-box">
          <div className="swap-box__top">
            <span>You pay</span>
            {sel(from, setFrom)}
          </div>
          <input
            className="swap-amt"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <button className="swap-flip" onClick={flip} title="Flip">
          ⇅
        </button>

        {/* TO */}
        <div className="swap-box">
          <div className="swap-box__top">
            <span>You receive</span>
            {sel(to, setTo)}
          </div>
          <div className="swap-out">
            {loading ? "…" : quote ? Number(quote.toAmount).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0.0"}
          </div>
        </div>

        {/* quote details */}
        {quote && !loading && (
          <div className="swap-info">
            <div>
              <span>Rate</span>
              <strong>
                1 {from.symbol} ≈ {rate ? rate.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"} {to.symbol}
              </strong>
            </div>
            <div>
              <span>Network fee</span>
              <strong>{quote.gasUsd ? `$${quote.gasUsd}` : "—"}</strong>
            </div>
            <div>
              <span>Route</span>
              <strong>{quote.tool}</strong>
            </div>
          </div>
        )}

        {/* action */}
        {!w.connected ? (
          <button className="btn btn--primary btn--block" onClick={() => w.login()}>
            Connect wallet to swap
          </button>
        ) : !w.onBase ? (
          <button className="btn btn--primary btn--block" onClick={() => w.switchToBase()}>
            Switch to Base
          </button>
        ) : (
          <button className="btn btn--primary btn--block" disabled={!quote || busy || loading} onClick={doSwap}>
            {busy ? status || "Swapping…" : loading ? "Fetching best price…" : quote ? `Swap ${from.symbol} → ${to.symbol}` : "Enter an amount"}
          </button>
        )}

        {/* custom token */}
        <div className="swap-custom">
          <input
            type="text"
            placeholder="Add token by address (0x… on Base)"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button className="btn btn--ghost btn--mini" onClick={addCustom} disabled={!custom.trim()}>
            Add
          </button>
        </div>

        <p className="swap-foot">
          Routed by LI.FI across Base DEXs · you sign in your wallet ·{" "}
          <a href={`${BASE.explorer}`} target="_blank" rel="noopener noreferrer">
            Basescan ↗
          </a>
        </p>
        <p className="swap-foot swap-foot--dim">Balance: {fmtEth(store.baseEth)} ETH on Base</p>
      </article>
    </section>
  );
}
