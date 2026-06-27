// ETH spot price in USD — keyless, CORS-friendly. Coinbase first (fast, reliable),
// CoinGecko as a fallback. Used to show a "≈ $x" hint next to every ETH amount.
export async function fetchEthUsd(): Promise<number | null> {
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const p = Number(j?.data?.amount);
      if (Number.isFinite(p) && p > 0) return p;
    }
  } catch {
    /* fall through */
  }
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    if (r.ok) {
      const j = await r.json();
      const p = Number(j?.ethereum?.usd);
      if (Number.isFinite(p) && p > 0) return p;
    }
  } catch {
    /* give up quietly — UI just hides the hint */
  }
  return null;
}
