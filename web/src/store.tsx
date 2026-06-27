import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ethers } from "ethers";
import { useWallet } from "./wallet";
import { useIrys } from "./hooks";
import { nodeBalance } from "./irys";
import { fetchInventory, type InvItem } from "./inventory";
import { fetchEthUsd } from "./price";
import { toast, errMsg } from "./ui";

interface Store {
  irys: any;
  baseEth: string | null;
  nodeEth: string | null;
  ethUsd: number | null;
  refresh: () => Promise<void>;
  inventory: InvItem[];
  inventoryLoading: boolean;
  loadInventory: (announce?: boolean) => Promise<void>;
}

const StoreContext = createContext<Store>({
  irys: null,
  baseEth: null,
  nodeEth: null,
  ethUsd: null,
  refresh: async () => {},
  inventory: [],
  inventoryLoading: false,
  loadInventory: async () => {},
});

export const useStore = () => useContext(StoreContext);

export function StoreProvider({ children }: { children: ReactNode }) {
  const w = useWallet();
  const irys = useIrys();
  const [baseEth, setBaseEth] = useState<string | null>(null);
  const [nodeEth, setNodeEth] = useState<string | null>(null);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [inventory, setInventory] = useState<InvItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!w.connected || !w.address) {
      setBaseEth(null);
      setNodeEth(null);
      return;
    }
    try {
      const provider = await w.getProvider();
      if (provider) {
        const bp = new ethers.BrowserProvider(provider as any);
        setBaseEth(ethers.formatEther(await bp.getBalance(w.address)));
      }
    } catch {
      /* ignore */
    }
    if (irys) {
      try {
        setNodeEth(await nodeBalance(irys));
      } catch {
        /* ignore */
      }
    }
  }, [w.connected, w.address, irys]);

  const loadInventory = useCallback(
    async (announce = false) => {
      if (!w.address) {
        setInventory([]);
        return;
      }
      if (announce) toast("Querying the Irys index…");
      setInventoryLoading(true);
      try {
        const inv = await fetchInventory(w.address);
        setInventory(inv);
        if (announce) toast(`${inv.length} item(s) on-chain`, "ok");
      } catch (e) {
        toast(`Vault: ${errMsg(e)}`, "err");
      } finally {
        setInventoryLoading(false);
      }
    },
    [w.address],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  // ETH/USD spot — refresh on mount and every 60s so every "≈ $x" stays live.
  useEffect(() => {
    let alive = true;
    const tick = () => fetchEthUsd().then((p) => alive && p != null && setEthUsd(p));
    void tick();
    const id = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <StoreContext.Provider value={{ irys, baseEth, nodeEth, ethUsd, refresh, inventory, inventoryLoading, loadInventory }}>
      {children}
    </StoreContext.Provider>
  );
}
