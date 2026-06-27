import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SOUL_PRESETS, type SoulConfig } from "./soul";

// Holds the active Neural Soul so the Soul tab configures it and the Engine →
// iIrys metadata flow can inject it into every NFT. Persisted across reloads.

const KEY = "iirysframe.soul.v1";

interface SoulCtx {
  soul: SoulConfig;
  setSoul: (s: SoulConfig) => void;
  patch: (p: Partial<SoulConfig>) => void;
}

const Ctx = createContext<SoulCtx>({
  soul: SOUL_PRESETS.iCLONE,
  setSoul: () => {},
  patch: () => {},
});

export const useSoul = () => useContext(Ctx);

function load(): SoulConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && typeof saved === "object" && "systemPrompt" in saved) return { ...SOUL_PRESETS.Custom, ...saved };
  } catch {
    /* ignore */
  }
  return { ...SOUL_PRESETS.iCLONE };
}

export function SoulProvider({ children }: { children: ReactNode }) {
  const [soul, setSoulState] = useState<SoulConfig>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(soul));
    } catch {
      /* ignore */
    }
  }, [soul]);

  const setSoul = (s: SoulConfig) => setSoulState(s);
  const patch = (p: Partial<SoulConfig>) => setSoulState((s) => ({ ...s, ...p }));

  return <Ctx.Provider value={{ soul, setSoul, patch }}>{children}</Ctx.Provider>;
}
