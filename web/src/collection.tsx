import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { APP_NAME, FREE_THRESHOLD, type Tag } from "./config";
import { useStore } from "./store";
import { useWallet } from "./wallet";
import { priceOf, ensureFunded, uploadData, blobToBytes } from "./irys";
import { buildMetadata, metadataToBytes, type Attribute } from "./metadata";
import { buildAiSoul, type SoulConfig } from "./soul";
import { toast, errMsg } from "./ui";

// Bridge between the Engine (generates a collection) and the iIrys tab (seals it
// on Irys, pays once, and returns every permanent link). Holds the staged
// collection in memory; nothing is written until the user seals in iIrys.

export interface StagedVariant {
  id: number;
  name: string; // trait value
  trait: string; // trait_type
  blob: Blob;
}
export interface StagedItem {
  edition: number;
  name: string;
  dna: string;
  blob: Blob; // composed final image
  attributes: Attribute[];
  variantIds: number[];
}
export interface Staged {
  collection: string;
  description: string;
  variants: StagedVariant[]; // unique source layers across the collection
  items: StagedItem[];
  soul: SoulConfig | null; // AI agent identity injected into every token's metadata
}

export interface ItemReceipt {
  edition: number;
  name: string;
  item: string;
  dna: string;
  image: string; // gateway URL of the final image
  metadata: string; // tokenURI (the mint link)
  mutable: string;
  ok: boolean;
  error?: string;
}
export interface LayerReceipt {
  id: number;
  trait: string;
  name: string;
  url: string;
}

export interface Cost {
  atomic: bigint;
  eth: string;
  free: boolean;
  paidCount: number;
  freeCount: number;
  bytes: number;
}

interface CollectionCtx {
  staged: Staged | null;
  setStaged: (s: Staged | null) => void;
  cost: Cost | null;
  computeCost: () => Promise<void>;
  sealing: boolean;
  progress: { phase: "layers" | "items"; done: number; total: number } | null;
  receipts: ItemReceipt[];
  layerReceipts: LayerReceipt[];
  sealAll: () => Promise<void>;
}

const noop = () => {};
const Ctx = createContext<CollectionCtx>({
  staged: null,
  setStaged: noop,
  cost: null,
  computeCost: async () => {},
  sealing: false,
  progress: null,
  receipts: [],
  layerReceipts: [],
  sealAll: async () => {},
});

export const useCollection = () => useContext(Ctx);

export function CollectionProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const w = useWallet();
  const [staged, setStagedState] = useState<Staged | null>(null);
  const [cost, setCost] = useState<Cost | null>(null);
  const [sealing, setSealing] = useState(false);
  const [progress, setProgress] = useState<CollectionCtx["progress"]>(null);
  const [receipts, setReceipts] = useState<ItemReceipt[]>([]);
  const [layerReceipts, setLayerReceipts] = useState<LayerReceipt[]>([]);

  const setStaged = useCallback((s: Staged | null) => {
    setStagedState(s);
    setReceipts([]);
    setLayerReceipts([]);
    setCost(null);
  }, []);

  const allBlobs = (s: Staged): Blob[] => [...s.variants.map((v) => v.blob), ...s.items.map((i) => i.blob)];

  const computeCost = useCallback(async () => {
    const irys = store.irys;
    if (!staged) return setCost(null);
    if (!irys) return setCost(null);
    let atomic = 0n;
    let paid = 0;
    let free = 0;
    let bytes = 0;
    for (const b of allBlobs(staged)) {
      bytes += b.size;
      if (b.size >= FREE_THRESHOLD) {
        atomic += BigInt((await priceOf(irys, b.size)).atomic);
        paid++;
      } else free++;
    }
    setCost({ atomic, eth: irys.utils.fromAtomic(atomic.toString()).toString(), free: atomic === 0n, paidCount: paid, freeCount: free, bytes });
  }, [staged, store.irys]);

  const sealAll = useCallback(async () => {
    const irys = store.irys;
    if (!irys) return toast("Connect your wallet first", "err");
    if (!staged) return toast("Nothing to seal — generate a collection in 2D NFT", "err");

    setSealing(true);
    setReceipts([]);
    setLayerReceipts([]);
    try {
      // total cost, then fund the whole batch with a single wallet tx
      let atomic = 0n;
      for (const b of allBlobs(staged)) if (b.size >= FREE_THRESHOLD) atomic += BigInt((await priceOf(irys, b.size)).atomic);
      if (atomic > 0n) {
        const provider = await w.getProvider();
        if (!provider) throw new Error("Wallet provider unavailable — reconnect the wallet.");
        await ensureFunded(irys, atomic, provider);
      }

      const tag = (extra: Record<string, string>): Tag[] => {
        const t: Tag[] = [
          { name: "App-Name", value: APP_NAME },
          { name: "Collection", value: staged.collection },
        ];
        for (const [k, v] of Object.entries(extra)) if (v) t.push({ name: k, value: v });
        return t;
      };

      // 1 · unique source layers → permanent "layer bank" (one Item card in the Vault)
      const layerItem = `${staged.collection} · layers`;
      const lrecs: LayerReceipt[] = [];
      let i = 0;
      for (const v of staged.variants) {
        setProgress({ phase: "layers", done: i, total: staged.variants.length });
        try {
          const out = await uploadData(
            irys,
            await blobToBytes(v.blob),
            v.blob.type || "image/png",
            tag({ Type: "layer", Item: layerItem, Trait: v.trait, "Layer-Name": v.name, "Variant-Id": String(v.id) }),
          );
          lrecs.push({ id: v.id, trait: v.trait, name: v.name, url: out.url });
          setLayerReceipts([...lrecs]);
        } catch (e) {
          toast(`Layer "${v.name}" failed: ${errMsg(e)}`, "err");
        }
        i++;
        setProgress({ phase: "layers", done: i, total: staged.variants.length });
      }

      // 2 · per item → final image + ERC-721 metadata (the mint link)
      const recs: ItemReceipt[] = [];
      i = 0;
      for (const it of staged.items) {
        setProgress({ phase: "items", done: i, total: staged.items.length });
        const item = crypto.randomUUID();
        const rec: ItemReceipt = { edition: it.edition, name: it.name, item, dna: it.dna, image: "", metadata: "", mutable: "", ok: false };
        try {
          const img = await uploadData(
            irys,
            await blobToBytes(it.blob),
            "image/png",
            tag({ Type: "final", Item: item, Edition: String(it.edition), DNA: it.dna, Name: it.name }),
          );
          rec.image = img.url;
          const aiSoul = staged.soul ? (buildAiSoul(staged.soul, it.edition) as unknown as Record<string, unknown>) : undefined;
          const meta = buildMetadata({ name: it.name, description: staged.description, image: img.url, attributes: it.attributes, ai_soul: aiSoul });
          const md = await uploadData(
            irys,
            metadataToBytes(meta),
            "application/json",
            tag({ Type: "metadata", Item: item, Edition: String(it.edition), DNA: it.dna, Name: it.name }),
          );
          rec.metadata = md.url;
          rec.mutable = md.mutableUrl;
          rec.ok = true;
        } catch (e) {
          rec.error = errMsg(e);
          toast(`Item #${it.edition} falhou: ${errMsg(e)}`, "err");
        }
        recs.push(rec);
        setReceipts([...recs]);
        i++;
        setProgress({ phase: "items", done: i, total: staged.items.length });
      }

      const ok = recs.filter((r) => r.ok).length;
      toast(`${ok}/${recs.length} items written to Irys`, ok === recs.length ? "ok" : "err");
      await store.refresh();
      void store.loadInventory();
    } catch (e) {
      toast(`Selagem falhou: ${errMsg(e)}`, "err");
    } finally {
      setSealing(false);
      setProgress(null);
    }
  }, [staged, store, w]);

  return (
    <Ctx.Provider value={{ staged, setStaged, cost, computeCost, sealing, progress, receipts, layerReceipts, sealAll }}>
      {children}
    </Ctx.Provider>
  );
}
