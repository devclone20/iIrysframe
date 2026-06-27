// Generative art engine (HashLips-style) — pure logic, no DOM.
// Picks one weighted variant per participating trait, guarantees unique DNA,
// and scores statistical rarity. The browser layer (Engine.tsx) composes the
// chosen variants onto a canvas and seals each item on Irys.

export interface Variant {
  id: number;
  file: File;
  name: string; // trait value, e.g. "Gold" (editable; defaults to filename)
  weight: number; // rarity weight within its trait (relative)
  url: string; // object URL for preview/compose
  size: number;
}

export interface Trait {
  id: string;
  name: string; // trait_type, e.g. "Background"
  required: boolean; // must always be present (validation)
  visible: boolean; // off → excluded from generation + art
  overlay: boolean; // always composited on top (e.g. QR)
  variants: Variant[];
}

export interface Pick {
  traitId: string;
  traitName: string;
  traitIndex: number; // position among participating traits (stable DNA)
  variant: Variant;
}

export interface Combo {
  edition: number;
  dna: string;
  picks: Pick[];
}

export interface GenResult {
  combos: Combo[];
  requested: number;
  max: number;
  capped: boolean; // requested > max → clamped
}

/** Traits that contribute a trait to every generated item. */
export function participatingTraits(traits: Trait[]): Trait[] {
  return traits.filter((t) => t.visible && t.variants.length > 0);
}

/** Total number of unique combinations possible (product of variant counts). */
export function maxCombos(traits: Trait[]): number {
  const parts = participatingTraits(traits);
  if (!parts.length) return 0;
  return parts.reduce((n, t) => n * t.variants.length, 1);
}

function pickWeighted(variants: Variant[], rng: () => number): Variant {
  const total = variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) return variants[Math.floor(rng() * variants.length)] ?? variants[0]!;
  let r = rng() * total;
  for (const v of variants) {
    r -= Math.max(0, v.weight);
    if (r <= 0) return v;
  }
  return variants[variants.length - 1]!;
}

/**
 * Generate `count` unique items. Weighted random per trait, de-duplicated by
 * DNA. Clamps to the maximum possible combinations and bounds attempts so it
 * can never spin forever as it approaches saturation.
 */
export function generate(traits: Trait[], count: number, rng: () => number = Math.random): GenResult {
  const parts = participatingTraits(traits);
  const max = maxCombos(traits);
  const target = Math.max(0, Math.min(Math.floor(count) || 0, max));
  const seen = new Set<string>();
  const combos: Combo[] = [];
  let attempts = 0;
  const cap = target * 80 + 2000;
  while (combos.length < target && attempts < cap) {
    attempts++;
    const picks: Pick[] = parts.map((t, i) => ({
      traitId: t.id,
      traitName: t.name,
      traitIndex: i,
      variant: pickWeighted(t.variants, rng),
    }));
    const dna = picks.map((p) => `${p.traitIndex}:${p.variant.id}`).join("-");
    if (seen.has(dna)) continue;
    seen.add(dna);
    combos.push({ edition: combos.length + 1, dna, picks });
  }
  return { combos, requested: Math.floor(count) || 0, max, capped: count > max };
}

/** Compose order for one item: base traits (in order), then overlays on top. */
export function composeOrder(combo: Combo, traits: Trait[]): Pick[] {
  const overlay = new Set(traits.filter((t) => t.overlay).map((t) => t.id));
  const base = combo.picks.filter((p) => !overlay.has(p.traitId));
  const top = combo.picks.filter((p) => overlay.has(p.traitId));
  return [...base, ...top];
}

/**
 * Statistical rarity score per edition: Σ (N / occurrences(value)). Rarer
 * traits push the score up. Returns score + 1-based rank (1 = rarest).
 */
export function rarity(combos: Combo[]): Map<number, { score: number; rank: number }> {
  const freq = new Map<string, number>();
  for (const c of combos)
    for (const p of c.picks) {
      const k = `${p.traitIndex}:${p.variant.id}`;
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
  const n = Math.max(1, combos.length);
  const scores = combos.map((c) => {
    let s = 0;
    for (const p of c.picks) s += n / (freq.get(`${p.traitIndex}:${p.variant.id}`) ?? 1);
    return { edition: c.edition, score: s };
  });
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const rankOf = new Map<number, number>();
  ranked.forEach((r, i) => rankOf.set(r.edition, i + 1));
  const out = new Map<number, { score: number; rank: number }>();
  for (const s of scores) out.set(s.edition, { score: s.score, rank: rankOf.get(s.edition) ?? 0 });
  return out;
}

/** Variant share within its trait, as a percentage of total weight. */
export function variantShare(trait: Trait, variant: Variant): number {
  const total = trait.variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) return trait.variants.length ? 100 / trait.variants.length : 0;
  return (Math.max(0, variant.weight) / total) * 100;
}
