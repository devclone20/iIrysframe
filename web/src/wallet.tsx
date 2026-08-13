import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { BASE, type Eip1193Provider } from "./config";
import { toast } from "./ui";

export interface WalletState {
  available: boolean; // Privy configured
  ready: boolean;
  connected: boolean;
  address: string | null;
  walletType: string | null;
  email: string | null;
  chainId: number | null;
  onBase: boolean;
  login: () => void;
  logout: () => void | Promise<void>;
  getProvider: () => Promise<Eip1193Provider | null>;
  switchToBase: () => Promise<void>;
  /** Switch the wallet to any supported chain (Base 8453, Robinhood 4663). */
  switchTo: (chainId: number) => Promise<void>;
}

const STUB: WalletState = {
  available: false,
  ready: true,
  connected: false,
  address: null,
  walletType: null,
  email: null,
  chainId: null,
  onBase: false,
  login: () => toast("Set VITE_PRIVY_APP_ID in web/.env, then restart, to enable wallet login.", "err"),
  logout: () => {},
  getProvider: async () => null,
  switchToBase: async () => {},
  switchTo: async () => {},
};

const WalletContext = createContext<WalletState>(STUB);
export const useWallet = () => useContext(WalletContext);

function parseChainId(caip: string | number | undefined | null): number | null {
  if (caip == null) return null;
  if (typeof caip === "number") return caip;
  const tail = String(caip).split(":").pop();
  const n = Number.parseInt(tail ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

/** Wraps Privy hooks into our wallet context. Render only inside PrivyProvider. */
export function PrivyWalletProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();

  const value = useMemo<WalletState>(() => {
    const wanted = user?.wallet?.address?.toLowerCase();
    const active = wallets.find((w) => w.address?.toLowerCase() === wanted) ?? wallets[0] ?? null;
    const chainId = parseChainId(active?.chainId);
    return {
      available: true,
      ready,
      connected: authenticated && !!active,
      address: active?.address ?? null,
      walletType: active?.walletClientType ?? null,
      email: user?.email?.address ?? null,
      chainId,
      onBase: chainId === BASE.id,
      login,
      logout,
      getProvider: async () => (active ? ((await active.getEthereumProvider()) as Eip1193Provider) : null),
      switchToBase: async () => {
        if (active) await active.switchChain(BASE.id);
      },
      switchTo: async (chainId: number) => {
        if (active) await active.switchChain(chainId);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, user, wallets]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function StubWalletProvider({ children }: { children: ReactNode }) {
  return <WalletContext.Provider value={STUB}>{children}</WalletContext.Provider>;
}
