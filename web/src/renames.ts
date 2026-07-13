// Collection display names. Irys tags are permanent, so a rename is a local
// display alias — plus, when a CloneForge contract is live, a re-sealed
// collection profile pushed into `contractURI` so OpenSea picks the new name up.

import { useEffect, useState } from "react";

const KEY = "iirys.collection.aliases.v1";

function load(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

let aliases = load();
const subs = new Set<() => void>();

export function aliasOf(key: string): string | undefined {
  return aliases[key];
}

export function setAlias(key: string, name: string) {
  if (name.trim()) aliases = { ...aliases, [key]: name.trim() };
  else {
    const { [key]: _, ...rest } = aliases;
    aliases = rest;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(aliases));
  } catch {
    /* quota */
  }
  subs.forEach((s) => s());
}

export function useAliases(): Record<string, string> {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((x) => x + 1);
    subs.add(s);
    return () => {
      subs.delete(s);
    };
  }, []);
  return aliases;
}
