import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ethers } from "ethers";
import { useWallet } from "./wallet";
import { useIrys } from "./hooks";
import { nodeBalance } from "./irys";
import { fetchInventory, type InvItem } from "./inventory";
import { fetchEthUsd } from "./price";
import { toast, errMsg } from "./ui";
import { BASE } from "./config";
import { fetchAssetBalances, loadAssetPrefs, saveAssetPrefs, type AssetBalance } from "./assets";

interface Store {
  irys: any;
  baseEth: string | null;
  nodeEth: string | null;
  ethUsd: number | null;
  refresh: () => Promise<void>;
  inventory: InvItem[];
  inventoryLoading: boolean;
  loadInventory: (announce?: boolean) => Promise<void>;
  assets: AssetBalance[];
  assetsLoading: boolean;
  assetPrefs: Set<string>;
  toggleAsset: (id: string, on: boolean) => void;
  refreshAssets: (fresh?: boolean) => Promise<void>;
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
  assets: [],
  assetsLoading: false,
  assetPrefs: new Set(),
  toggleAsset: () => {},
  refreshAssets: async () => {},
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
  const [assets, setAssets] = useState<AssetBalance[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetPrefs, setAssetPrefs] = useState<Set<string>>(() => loadAssetPrefs());

  const refreshAssets = useCallback(
    async (fresh = false) => {
      if (!w.address) {
        setAssets([]);
        return;
      }
      setAssetsLoading(true);
      try {
        setAssets(await fetchAssetBalances(w.address, { prefs: loadAssetPrefs(), fresh }));
      } finally {
        setAssetsLoading(false);
      }
    },
    [w.address],
  );

  const toggleAsset = useCallback(
    (id: string, on: boolean) => {
      const next = new Set(loadAssetPrefs());
      if (on) next.add(id);
      else next.delete(id);
      saveAssetPrefs(next);
      setAssetPrefs(next);
      void refreshAssets();
    },
    [refreshAssets],
  );

  const refresh = useCallback(async () => {
    if (!w.connected || !w.address) {
      setBaseEth(null);
      setNodeEth(null);
      setAssets([]);
      return;
    }
    // Base ETH must come from Base's own RPC, never the wallet provider — the
    // wallet may be switched to another chain (e.g. Robinhood 4663) and would
    // silently report that chain's balance as "Base".
    try {
      const rp = new ethers.JsonRpcProvider(BASE.rpc);
      setBaseEth(ethers.formatEther(await rp.getBalance(w.address)));
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
    void refreshAssets(); // fire-and-forget: the list fills as chains answer
  }, [w.connected, w.address, irys, refreshAssets]);

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
    <StoreContext.Provider
      value={{
        irys,
        baseEth,
        nodeEth,
        ethUsd,
        refresh,
        inventory,
        inventoryLoading,
        loadInventory,
        assets,
        assetsLoading,
        assetPrefs,
        toggleAsset,
        refreshAssets,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}
