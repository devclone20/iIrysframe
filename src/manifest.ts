import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { UploadResult } from "./irys.js";

export interface ManifestEntry extends UploadResult {
  collection?: string;
  tier?: string;
}

const FILE = config.manifestPath;

function readSync(): ManifestEntry[] {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let queue: Promise<void> = Promise.resolve();

/** Serialize writes so concurrent uploads never corrupt the manifest. */
async function persist(entries: ManifestEntry[]): Promise<void> {
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
  await fsp.rename(tmp, FILE);
}

export function listAssets(): ManifestEntry[] {
  return readSync().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function appendAsset(entry: ManifestEntry): Promise<ManifestEntry> {
  queue = queue.then(async () => {
    const entries = readSync();
    // de-dupe by tx id
    if (!entries.some((e) => e.id === entry.id)) entries.push(entry);
    await persist(entries);
  });
  return queue.then(() => entry);
}

export function stats() {
  const entries = readSync();
  const totalBytes = entries.reduce((sum, e) => sum + (e.size || 0), 0);
  const collections = new Set(entries.map((e) => e.collection).filter(Boolean));
  return {
    count: entries.length,
    totalBytes,
    collections: collections.size,
  };
}

// Ensure the file exists so the dashboard's first read is clean.
if (!fs.existsSync(FILE)) {
  try {
    fs.writeFileSync(FILE, "[]", "utf8");
  } catch {
    /* non-fatal */
  }
}

export { FILE as MANIFEST_FILE, path as _path };
