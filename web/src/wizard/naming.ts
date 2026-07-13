// Naming engine — how every item of the collection gets its name.
// Deterministic given the same seed so previews match what gets sealed.

export type NamingScheme =
  | "prefix-seq" // "iCLONE #1", "iCLONE #2", …
  | "random-id" // "iCLONE #48213" (format configurable)
  | "nameset-id" // "Atlas #1", "Nova #2" — curated name sets
  | "rarity-ranked" // rarest tier gets the lowest ids: "#1" = top tier
  | "single"; // one item, free-text name

export type IdFormat = "seq" | "num4" | "num6" | "hex4" | "alnum5";

export interface NamingConfig {
  collection: string;
  scheme: NamingScheme;
  prefix: string; // used by prefix-seq / random-id / rarity-ranked
  idFormat: IdFormat;
  nameset: string; // key of NAME_SETS
  singleName: string;
  seed: number; // random schemes stay stable across previews
}

export const DEFAULT_NAMING: NamingConfig = {
  collection: "iCLONE Genesis",
  scheme: "prefix-seq",
  prefix: "iCLONE #",
  idFormat: "seq",
  nameset: "mythic",
  singleName: "",
  seed: 1717,
};

export const NAME_SETS: Record<string, { label: string; names: string[] }> = {
  mythic: {
    label: "Mythic",
    names: [
      "Atlas", "Nova", "Orion", "Lyra", "Titan", "Vega", "Kairo", "Nyx", "Zephyr", "Aion",
      "Helios", "Selene", "Argo", "Rhea", "Kronos", "Astra", "Phoenix", "Hydra", "Cygnus", "Erebus",
    ],
  },
  cyber: {
    label: "Cyber",
    names: [
      "Vector", "Cipher", "Pulse", "Neon", "Glitch", "Proxy", "Kernel", "Socket", "Quantum", "Raster",
      "Synth", "Matrix", "Codec", "Beacon", "Drift", "Volt", "Echo", "Nexus", "Prism", "Signal",
    ],
  },
  anime: {
    label: "Anime",
    names: [
      "Ryu", "Akira", "Hikari", "Kaito", "Sora", "Ren", "Yuki", "Haru", "Kenji", "Mira",
      "Taro", "Aoi", "Riku", "Hana", "Shin", "Kuro", "Rei", "Jin", "Nami", "Zoru",
    ],
  },
  frame: {
    label: "CLONE FRAME",
    names: [
      "iCLONE", "VEGETA", "GOKU", "MATRIX", "RIDER", "DOCTOR", "AKITA", "HACKER", "ORACLE", "FORGE",
      "LAYER", "VAULT", "PRIME", "GENESIS", "SOUL", "ENGINE", "FRAME", "IRYS", "BASE", "AGENT",
    ],
  },
};

// deterministic PRNG (mulberry32)
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatId(format: IdFormat, index: number, rand: () => number, used: Set<string>): string {
  if (format === "seq") return String(index + 1);
  for (let tries = 0; tries < 9999; tries++) {
    let id = "";
    if (format === "num4") id = String(Math.floor(rand() * 9000) + 1000);
    else if (format === "num6") id = String(Math.floor(rand() * 900000) + 100000);
    else if (format === "hex4") id = Math.floor(rand() * 0xffff).toString(16).toUpperCase().padStart(4, "0");
    else id = Array.from({ length: 5 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(rand() * 31)]).join("");
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  return String(index + 1);
}

export interface NamedItem {
  index: number;
  tier?: string;
}

/**
 * Produce the final display name for every item, in item order.
 * `tierRank` orders tiers rarest-first for the rarity-ranked scheme.
 */
export function generateNames(cfg: NamingConfig, items: NamedItem[], tierRank: string[] = []): string[] {
  const rand = rng(cfg.seed);
  const used = new Set<string>();
  const prefix = cfg.prefix || `${cfg.collection || "Item"} #`;

  if (cfg.scheme === "single") {
    return items.map(() => cfg.singleName || cfg.collection || "Item");
  }
  if (cfg.scheme === "prefix-seq") {
    return items.map((_, i) => `${prefix}${i + 1}`);
  }
  if (cfg.scheme === "random-id") {
    return items.map((_, i) => `${prefix}${formatId(cfg.idFormat === "seq" ? "num4" : cfg.idFormat, i, rand, used)}`);
  }
  if (cfg.scheme === "nameset-id") {
    const set = NAME_SETS[cfg.nameset]?.names ?? NAME_SETS.mythic!.names;
    return items.map((_, i) => {
      const name = set[i % set.length]!;
      const round = Math.floor(i / set.length);
      const suffix = formatId(cfg.idFormat, i, rand, used);
      return round === 0 && cfg.idFormat === "seq" ? `${name} #${suffix}` : `${name} #${suffix}`;
    });
  }
  // rarity-ranked: rarest tier → lowest ids, stable within tier
  const rank = (t?: string) => {
    const i = tierRank.indexOf(t ?? "");
    return i === -1 ? tierRank.length : i;
  };
  const order = [...items].sort((a, b) => rank(a.tier) - rank(b.tier) || a.index - b.index);
  const names = new Array<string>(items.length);
  order.forEach((it, pos) => {
    names[it.index] = `${prefix}${pos + 1}`;
  });
  return names;
}

/** Short human description of a scheme (shown under the option). */
export const SCHEME_INFO: Record<NamingScheme, { label: string; hint: string }> = {
  "prefix-seq": { label: "Prefix + sequential", hint: "iCLONE #1, iCLONE #2, …" },
  "random-id": { label: "Random ID", hint: "iCLONE #4821 — pick the ID format" },
  "nameset-id": { label: "Name set + ID", hint: "Atlas #1, Nova #2 — curated sets" },
  "rarity-ranked": { label: "Ranked by rarity", hint: "#1 = rarest item of the collection" },
  single: { label: "Single name", hint: "One item, one name" },
};
