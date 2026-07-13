// IndexedDB persistence for wizard items — processed results (optimized glb,
// posters, seal links) survive page reloads and wallet-triggered navigations.
// Original Files are NOT restorable; everything derived from them is.

import type { WizItem } from "./wizardStore";

const DB = "iirys-wizard";
const STORE = "items";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface StoredItem {
  id: string;
  sourceName: string;
  name: string;
  size: number;
  status: WizItem["status"];
  error?: string;
  glb?: Blob; // stored as Blob (structured-clone friendly)
  before?: number;
  after?: number;
  tris?: number;
  clips?: number;
  poster?: Blob;
  attributes?: WizItem["attributes"];
  tier?: string;
  soulId?: string;
  sealed?: WizItem["sealed"];
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced write of the full item list (bytes → Blobs). */
export function saveItems(items: WizItem[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void (async () => {
      try {
        const db = await open();
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.clear();
        items.forEach((it, i) => {
          const rec: StoredItem = {
            id: it.id,
            sourceName: it.sourceName,
            name: it.name,
            size: it.size,
            // a reload can't resume half-done work: unprocessed → queued again;
            // interrupted seals keep their processed bytes → ready to re-seal
            status: it.status === "processing" ? "queued" : it.status === "sealing" ? "ready" : it.status,
            error: it.error,
            glb: it.glb ? new Blob([it.glb as unknown as BlobPart]) : undefined,
            before: it.before,
            after: it.after,
            tris: it.tris,
            clips: it.clips,
            poster: it.poster,
            attributes: it.attributes,
            tier: it.tier,
            soulId: it.soulId,
            sealed: it.sealed,
          };
          store.put(rec, `${String(i).padStart(5, "0")}:${it.id}`);
        });
        db.close();
      } catch {
        /* private mode / quota — items stay session-only */
      }
    })();
  }, 400);
}

/** Restore items after a reload (Files absent; processed bytes rehydrated). */
export async function loadItems(): Promise<WizItem[]> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const [keys, values] = await Promise.all([
      new Promise<IDBValidKey[]>((res, rej) => {
        const r = store.getAllKeys();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }),
      new Promise<StoredItem[]>((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result as StoredItem[]);
        r.onerror = () => rej(r.error);
      }),
    ]);
    db.close();
    const ordered = keys
      .map((k, i) => ({ k: String(k), v: values[i]! }))
      .sort((a, b) => a.k.localeCompare(b.k))
      .map((x) => x.v);
    const out: WizItem[] = [];
    for (const s of ordered) {
      // self-heal: anything with processed bytes is ready, whatever was stored
      const healed = s.status === "queued" && s.glb && s.poster ? "ready" : s.status;
      out.push({
        id: s.id,
        sourceName: s.sourceName,
        name: s.name,
        size: s.size,
        status: healed,
        error: s.error,
        glb: s.glb ? new Uint8Array(await s.glb.arrayBuffer()) : undefined,
        before: s.before,
        after: s.after,
        tris: s.tris,
        clips: s.clips,
        poster: s.poster,
        posterUrl: s.poster ? URL.createObjectURL(s.poster) : undefined,
        attributes: s.attributes,
        tier: s.tier,
        soulId: s.soulId,
        sealed: s.sealed,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function clearStoredItems(): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    db.close();
  } catch {
    /* ignore */
  }
}
