// Pure formatting helpers.

export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KiB", "MiB", "GiB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function trunc(s: string | null | undefined, head = 6, tail = 4): string {
  if (!s) return "—";
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export function shortAddr(a: string | null | undefined): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}

/** Deterministic accent gradient from an address — a tiny "identicon". */
export function addrGradient(addr: string | null | undefined): string {
  if (!addr) return "linear-gradient(135deg,#2a2f33,#1a1f23)";
  let h = 0;
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 60 + (h % 80)) % 360;
  return `linear-gradient(135deg, hsl(${a} 70% 55%), hsl(${b} 70% 45%))`;
}

export function fmtEth(v: string | number | null | undefined, digits = 4): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return n.toPrecision(digits);
}

/** ETH amount → USD number, or null if the price/amount isn't available. */
export function ethToUsd(eth: string | number | null | undefined, price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price) || eth == null || eth === "") return null;
  const n = typeof eth === "number" ? eth : Number.parseFloat(eth);
  if (!Number.isFinite(n)) return null;
  return n * price;
}

/** Compact USD formatter — "$12.34", "<$0.01", "$1,240". Empty string if null. */
export function fmtUsd(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "";
  if (usd === 0) return "$0.00";
  if (usd > 0 && usd < 0.01) return "<$0.01";
  const max = usd < 1000 ? 2 : 0;
  return "$" + usd.toLocaleString("en-US", { minimumFractionDigits: usd < 1000 ? 2 : 0, maximumFractionDigits: max });
}

/** Convenience: ETH amount straight to a "$x" string ("" when unavailable). */
export function usdOf(eth: string | number | null | undefined, price: number | null | undefined): string {
  return fmtUsd(ethToUsd(eth, price));
}
