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
  order?: number;
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
  posterProvided?: boolean;
  posterDims?: WizItem["posterDims"];
  hasOwnBg?: boolean;
  bakedHex?: string;
  bakedRim?: string;
  bgHex?: string | null;
  bgName?: string;
  attributes?: WizItem["attributes"];
  tier?: string;
  soulId?: string;
  sealed?: WizItem["sealed"];
  up?: WizItem["up"];
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Last object written per id. patchItem replaces only the item it touches, so
 * reference identity tells us exactly what changed — without it every patch
 * rewrote all 1111 records, re-wrapping every glb as a fresh Blob (gigabytes of
 * copies per save, and quota death long before the batch finished). */
const written = new Map<string, WizItem>();

/** Debounced, incremental write: only items whose object changed, plus removals. */
export function saveItems(items: WizItem[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void (async () => {
      try {
        const alive = new Set(items.map((i) => i.id));
        const changed = items.filter((it) => written.get(it.id) !== it);
        const removed = [...written.keys()].filter((id) => !alive.has(id));
        if (changed.length === 0 && removed.length === 0) return;
        const db = await open();
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const id of removed) {
          store.delete(id);
          written.delete(id);
        }
        items.forEach((it, i) => {
          if (written.get(it.id) === it) return;
          const rec: StoredItem = {
            order: i,
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
            posterProvided: it.posterProvided,
            posterDims: it.posterDims,
            hasOwnBg: it.hasOwnBg,
            bakedHex: it.bakedHex,
            bakedRim: it.bakedRim,
            bgHex: it.bgHex,
            bgName: it.bgName,
            attributes: it.attributes,
            tier: it.tier,
            soulId: it.soulId,
            sealed: it.sealed,
            up: it.up,
          };
          // keyed by id, ordered by the stored `order` — so re-ordering the
          // list does not force a rewrite of every record
          store.put(rec, it.id);
          written.set(it.id, it);
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
      .sort((a, b) => (a.v.order ?? Number.MAX_SAFE_INTEGER) - (b.v.order ?? Number.MAX_SAFE_INTEGER) || a.k.localeCompare(b.k))
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
        posterProvided: s.posterProvided,
        posterDims: s.posterDims,
        hasOwnBg: s.hasOwnBg,
        bakedHex: s.bakedHex,
        bakedRim: s.bakedRim,
        bgHex: s.bgHex,
        bgName: s.bgName,
        attributes: s.attributes,
        tier: s.tier,
        soulId: s.soulId,
        sealed: s.sealed,
        up: s.up,
      });
    }
    // seed the identity map: what we just read IS what the DB holds, so the
    // first patch after a reload writes one record, not all of them again
    written.clear();
    for (const it of out) written.set(it.id, it);
    return out;
  } catch {
    return [];
  }
}

export async function clearStoredItems(): Promise<void> {
  written.clear();
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    db.close();
  } catch {
    /* ignore */
  }
}
