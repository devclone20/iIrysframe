import { useEffect, useMemo, useState } from "react";
import { useCollection, type Staged, type StagedItem, type StagedVariant } from "../collection";
import { useSoul } from "../soulStore";
import { soulAttributes, soulReady } from "../soul";
import { drawComposite, canvasToBlob } from "../compose";
import { toast, errMsg, Drawer, CopyField } from "../ui";
import {
  type Trait,
  type Variant,
  type Combo,
  generate,
  maxCombos,
  participatingTraits,
  composeOrder,
  rarity,
  variantShare,
} from "../engine";

const STORAGE_KEY = "iirysframe.folders.schema.v1"; // shared with the old Studio schema
let seq = 0;
const uid = () => crypto.randomUUID();
const stripExt = (n: string) => n.replace(/\.[^.]+$/, "");

function defaultTraits(): Trait[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(saved) && saved.length) {
      return saved.map((s: any) => ({
        id: uid(),
        name: String(s.name ?? "Trait"),
        required: !!s.required,
        visible: s.visible !== false,
        overlay: !!s.overlay,
        variants: [],
      }));
    }
  } catch {
    /* ignore */
  }
  return [{ id: uid(), name: "Background", required: true, visible: true, overlay: false, variants: [] }];
}

interface Composed {
  edition: number;
  blob: Blob;
  url: string;
  dims: { width: number; height: number };
}

export function Engine({ goIrys }: { goIrys: () => void }) {
  const coll = useCollection();
  const { soul } = useSoul();

  const [traits, setTraits] = useState<Trait[]>(defaultTraits);
  const [collection, setCollection] = useState("iCLONE Genesis");
  const [baseName, setBaseName] = useState("iCLONE #");
  const [description, setDescription] = useState("");
  const [supply, setSupply] = useState(10);

  const [combos, setCombos] = useState<Combo[]>([]);
  const [composed, setComposed] = useState<Composed[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const max = useMemo(() => maxCombos(traits), [traits]);
  const parts = useMemo(() => participatingTraits(traits), [traits]);
  const rarityMap = useMemo(() => rarity(combos), [combos]);
  const composedByEd = useMemo(() => new Map(composed.map((c) => [c.edition, c])), [composed]);
  const sealedEds = useMemo(() => new Set(coll.receipts.filter((r) => r.ok).map((r) => r.edition)), [coll.receipts]);

  // persist the trait schema (names + flags, no files) — survives reloads
  useEffect(() => {
    const schema = traits.map((t) => ({ name: t.name, required: t.required, visible: t.visible, overlay: t.overlay }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(schema));
    } catch {
      /* ignore */
    }
  }, [traits]);

  // revoke all preview URLs on unmount
  useEffect(() => () => composed.forEach((c) => URL.revokeObjectURL(c.url)), [composed]);

  // ── trait ops ────────────────────────────────────────────────────────────────
  const patchTrait = (id: string, p: Partial<Trait>) => setTraits((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));

  function addTrait() {
    setTraits((ts) => [...ts, { id: uid(), name: `Trait ${ts.length + 1}`, required: false, visible: true, overlay: false, variants: [] }]);
  }
  function addQrTrait() {
    if (traits.some((t) => t.overlay && /qr/i.test(t.name))) return toast("QR overlay already exists");
    setTraits((ts) => [...ts, { id: uid(), name: "QR Code", required: true, visible: true, overlay: true, variants: [] }]);
    toast("QR overlay added (always on top)", "ok");
  }
  function removeTrait(id: string) {
    setTraits((ts) => {
      ts.find((t) => t.id === id)?.variants.forEach((v) => URL.revokeObjectURL(v.url));
      return ts.filter((t) => t.id !== id);
    });
  }
  function moveTrait(id: string, dir: -1 | 1) {
    setTraits((ts) => {
      const i = ts.findIndex((t) => t.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ts.length) return ts;
      const copy = [...ts];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });
  }
  function addVariants(id: string, files: FileList | File[]) {
    const next: Variant[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      next.push({ id: ++seq, file, name: stripExt(file.name), weight: 100, url: URL.createObjectURL(file), size: file.size });
    }
    if (next.length) patchTrait(id, { variants: [...(traits.find((t) => t.id === id)?.variants ?? []), ...next] });
  }
  function patchVariant(traitId: string, variantId: number, p: Partial<Variant>) {
    setTraits((ts) => ts.map((t) => (t.id === traitId ? { ...t, variants: t.variants.map((v) => (v.id === variantId ? { ...v, ...p } : v)) } : t)));
  }
  function removeVariant(traitId: string, variantId: number) {
    setTraits((ts) =>
      ts.map((t) => {
        if (t.id !== traitId) return t;
        t.variants.find((v) => v.id === variantId)?.url && URL.revokeObjectURL(t.variants.find((v) => v.id === variantId)!.url);
        return { ...t, variants: t.variants.filter((v) => v.id !== variantId) };
      }),
    );
  }

  function clearGenerated() {
    composed.forEach((c) => URL.revokeObjectURL(c.url));
    setCombos([]);
    setComposed([]);
    coll.setStaged(null);
  }

  // ── generate + compose ───────────────────────────────────────────────────────
  async function generateCollection() {
    if (!parts.length) return toast("Add variants to at least one trait", "err");
    const emptyRequired = traits.find((t) => t.required && t.visible && t.variants.length === 0);
    if (emptyRequired) return toast(`Required trait "${emptyRequired.name}" is empty`, "err");

    clearGenerated();
    const { combos: gen, capped, max: m } = generate(traits, supply);
    if (!gen.length) return toast("Nothing to generate", "err");
    if (capped) toast(`Only ${m} unique combinations exist — generated ${gen.length}`, "err");
    setCombos(gen);

    setGenBusy(true);
    setGenProgress({ done: 0, total: gen.length });
    const canvas = document.createElement("canvas");
    const out: Composed[] = [];
    try {
      for (const combo of gen) {
        const urls = composeOrder(combo, traits).map((p) => p.variant.url);
        const dims = await drawComposite(canvas, urls);
        const blob = await canvasToBlob(canvas);
        out.push({ edition: combo.edition, blob, url: URL.createObjectURL(blob), dims });
        setGenProgress({ done: out.length, total: gen.length });
        setComposed([...out]);
      }
      toast(`${out.length} items generated`, "ok");
    } catch (e) {
      toast(`Compose failed: ${errMsg(e)}`, "err");
    } finally {
      setGenBusy(false);
      setGenProgress(null);
    }
  }

  // ── publish the generated collection to the shared store (→ iIrys tab) ──────
  function buildStaged(): Staged | null {
    if (!combos.length || composed.length !== combos.length) return null;
    const variantById = new Map<number, { variant: Variant; trait: string }>();
    traits.forEach((t) => t.variants.forEach((v) => variantById.set(v.id, { variant: v, trait: t.name })));
    const usedIds = new Set<number>();
    combos.forEach((c) => c.picks.forEach((p) => usedIds.add(p.variant.id)));
    const variants: StagedVariant[] = [...usedIds]
      .map((id) => variantById.get(id))
      .filter((r): r is { variant: Variant; trait: string } => !!r)
      .map((r) => ({ id: r.variant.id, name: r.variant.name, trait: r.trait, blob: r.variant.file }));
    const soulAttrs = soulReady(soul) ? soulAttributes(soul) : [];
    const items: StagedItem[] = combos.map((c) => {
      const comp = composedByEd.get(c.edition)!;
      return {
        edition: c.edition,
        name: `${baseName}${c.edition}`,
        dna: c.dna,
        blob: comp.blob,
        attributes: [...composeOrder(c, traits).map((p) => ({ trait_type: p.traitName, value: p.variant.name })), ...soulAttrs],
        variantIds: c.picks.map((p) => p.variant.id),
      };
    });
    return { collection, description, variants, items, soul: soulReady(soul) ? soul : null };
  }

  // republish when generation completes (and when the collection text or soul changes)
  useEffect(() => {
    if (combos.length && composed.length === combos.length) coll.setStaged(buildStaged());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composed, combos, collection, baseName, description, soul]);

  function sendToIrys() {
    if (combos.length && composed.length === combos.length) coll.setStaged(buildStaged());
    goIrys();
  }

  const activeCombo = active != null ? combos.find((c) => c.edition === active) ?? null : null;

  return (
    <section className="view">
      <div className="rail">
        <Stat label="Traits" value={`${parts.length}`} sub={`${traits.length} total`} />
        <Stat label="Combinations" value={max > 0 ? max.toLocaleString() : "—"} sub="unique possible" />
        <Stat label="Supply" value={`${Math.min(supply, max || supply)}`} sub={supply > max && max > 0 ? `max ${max}` : "to generate"} />
        <Stat label="Generated" value={`${composed.length}`} sub={sealedEds.size ? `${sealedEds.size} on Irys` : "preview"} />
      </div>

      <div className="engine">
        {/* ── traits + rarity ── */}
        <article className="panel">
          <header className="panel__head">
            <h2>
              <span className="step">1</span> Traits &amp; rarity
            </h2>
            <div className="folder-actions">
              <button className="btn btn--ghost btn--mini" onClick={addTrait}>＋ Trait</button>
              <button className="btn btn--ghost btn--mini" onClick={addQrTrait}>＋ QR</button>
            </div>
          </header>
          <p className="folder-legend">
            Order bottom → top · <span className="ov">overlays</span> always on top · weight = rarity
          </p>

          <div className="folders">
            {traits.map((t, i) => (
              <TraitCard
                key={t.id}
                trait={t}
                index={i}
                first={i === 0}
                last={i === traits.length - 1}
                onName={(v) => patchTrait(t.id, { name: v })}
                onUp={() => moveTrait(t.id, -1)}
                onDown={() => moveTrait(t.id, 1)}
                onRemove={() => removeTrait(t.id)}
                onVisible={() => patchTrait(t.id, { visible: !t.visible })}
                onRequired={() => patchTrait(t.id, { required: !t.required })}
                onFiles={(files) => addVariants(t.id, files)}
                onVariant={(vid, p) => patchVariant(t.id, vid, p)}
                onRemoveVariant={(vid) => removeVariant(t.id, vid)}
              />
            ))}
          </div>
        </article>

        {/* ── collection settings + generate ── */}
        <article className="panel">
          <header className="panel__head">
            <h2>
              <span className="step">2</span> Collection
            </h2>
          </header>

          <div className="field">
            <label>Collection name</label>
            <input value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="iCLONE Genesis" />
          </div>
          <div className="form">
            <div className="field">
              <label>Name prefix</label>
              <input value={baseName} onChange={(e) => setBaseName(e.target.value)} placeholder="iCLONE #" />
            </div>
            <div className="field">
              <label>Quantity (supply)</label>
              <input
                type="number"
                min={1}
                max={Math.max(1, max)}
                value={supply}
                onChange={(e) => setSupply(Math.max(1, Number.parseInt(e.target.value || "1", 10)))}
              />
            </div>
          </div>
          <div className="field">
            <label>Description</label>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="An autonomous agent, sealed forever." />
          </div>

          <div className="gen-meta">
            {max > 0 ? (
              <>
                <strong>{Math.min(supply, max).toLocaleString()}</strong> items of <strong>{max.toLocaleString()}</strong> possible
                {supply > max && <span className="gen-warn"> · capped at {max.toLocaleString()}</span>}
              </>
            ) : (
              <span className="gen-warn">Add variants to the traits to generate</span>
            )}
          </div>

          <button className="btn btn--primary btn--block" disabled={genBusy || max === 0} onClick={generateCollection}>
            {genBusy && genProgress ? `Composing ${genProgress.done}/${genProgress.total}…` : "Generate collection"}
          </button>
          {composed.length > 0 && !genBusy && (
            <button className="btn btn--block" onClick={sendToIrys}>
              Seal on Irys ({composed.length} items)
            </button>
          )}
        </article>

        {/* ── generated gallery ── */}
        <article className="panel panel--gallery">
          <header className="panel__head">
            <h2>
              <span className="step">3</span> Generated collection
            </h2>
            {composed.length > 0 && (
              <button className="btn btn--ghost btn--mini" onClick={clearGenerated} disabled={genBusy}>
                Clear
              </button>
            )}
          </header>

          {composed.length === 0 ? (
            <div className="empty">
                            <p>
                {genBusy
                  ? "Generating…"
                  : "Configure the traits + weights and hit “Generate collection”. Each item is a unique combination, with computed rarity."}
              </p>
            </div>
          ) : (
            <div className="gallery">
              {composed.map((c) => {
                const r = rarityMap.get(c.edition);
                const sealed = sealedEds.has(c.edition);
                return (
                  <button className="genitem" key={c.edition} onClick={() => setActive(c.edition)}>
                    <div className="genitem__media">
                      <img loading="lazy" src={c.url} alt="" />
                      {r && <span className="genitem__rank">#{r.rank}</span>}
                      {sealed && <span className="genitem__sealed">✓</span>}
                    </div>
                    <div className="genitem__foot">
                      <span className="genitem__ed">{baseName}{c.edition}</span>
                      {r && <span className="genitem__score">{r.score.toFixed(1)}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </article>
      </div>

      <Drawer open={active != null} onClose={() => setActive(null)}>
        {activeCombo && (
          <ItemDetail
            combo={activeCombo}
            traits={traits}
            composed={composedByEd.get(activeCombo.edition) ?? null}
            rank={rarityMap.get(activeCombo.edition)}
            name={`${baseName}${activeCombo.edition}`}
            onClose={() => setActive(null)}
          />
        )}
      </Drawer>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      <span className="stat__sub">{sub}</span>
    </div>
  );
}

function TraitCard(props: {
  trait: Trait;
  index: number;
  first: boolean;
  last: boolean;
  onName: (v: string) => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  onVisible: () => void;
  onRequired: () => void;
  onFiles: (files: FileList | File[]) => void;
  onVariant: (id: number, p: Partial<Variant>) => void;
  onRemoveVariant: (id: number) => void;
}) {
  const { trait: t, index } = props;
  const [over, setOver] = useState(false);
  return (
    <div className={`folder ${t.visible ? "" : "is-hidden"} ${t.overlay ? "is-overlay" : ""}`}>
      <div className="folder__head">
        <span className="folder__idx">{index}</span>
        <input className="folder__name" value={t.name} onChange={(e) => props.onName(e.target.value)} spellCheck={false} />
        <div className="folder__order">
          <button onClick={props.onUp} disabled={props.first} title="Move up">↑</button>
          <button onClick={props.onDown} disabled={props.last} title="Move down">↓</button>
        </div>
      </div>

      <div className="folder__flags">
        <button className={`flag ${t.visible ? "on" : ""}`} onClick={props.onVisible} title="Included in generation">
          {t.visible ? "visible" : "hidden"}
        </button>
        <button className={`flag ${t.required ? "on" : ""}`} onClick={props.onRequired} title="Always present">
          {t.required ? "required" : "optional"}
        </button>
        {t.overlay && <span className="flag flag--ov">overlay (top)</span>}
        <span className="folder__count">{t.variants.length} {t.variants.length === 1 ? "variant" : "variants"}</span>
        <button className="folder__del" onClick={props.onRemove} title="Delete trait">✕</button>
      </div>

      {t.variants.length > 0 && (
        <div className="variants">
          {t.variants.map((v) => (
            <div className="variant" key={v.id}>
              <span className="variant__thumb">
                <img src={v.url} alt="" />
              </span>
              <input className="variant__name" value={v.name} onChange={(e) => props.onVariant(v.id, { name: e.target.value })} spellCheck={false} placeholder="value" />
              <div className="variant__weight">
                <input
                  type="number"
                  min={0}
                  value={v.weight}
                  onChange={(e) => props.onVariant(v.id, { weight: Math.max(0, Number.parseFloat(e.target.value) || 0) })}
                  title="Weight (rarity)"
                />
                <span className="variant__pct">{variantShare(t, v).toFixed(0)}%</span>
              </div>
              <button className="variant__x" onClick={() => props.onRemoveVariant(v.id)} title="Remove">✕</button>
            </div>
          ))}
        </div>
      )}

      <label
        className={`folder__drop ${over ? "is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files?.length) props.onFiles(e.dataTransfer.files);
        }}
      >
        <input type="file" multiple accept="image/*" hidden onChange={(e) => e.target.files && (props.onFiles(e.target.files), (e.target.value = ""))} />
        <span className="folder__drop-empty">Drop “{t.name}” variants</span>
      </label>
    </div>
  );
}

function ItemDetail({
  combo,
  traits,
  composed,
  rank,
  name,
  onClose,
}: {
  combo: Combo;
  traits: Trait[];
  composed: Composed | null;
  rank?: { score: number; rank: number };
  name: string;
  onClose: () => void;
}) {
  return (
    <>
      <button className="dd__close" onClick={onClose}>✕</button>
      <div className="dd__media">{composed ? <img src={composed.url} alt="" /> : <div className="ph">—</div>}</div>
      <div className="dd__title">{name}</div>
      <div className="dd__meta">
        {composed ? `${composed.dims.width}×${composed.dims.height}` : ""}
        {rank ? ` · rank #${rank.rank} · score ${rank.score.toFixed(1)}` : ""}
      </div>

      <div className="dd__row">
        <span>Traits</span>
        <div className="dd__traits">
          {composeOrder(combo, traits).map((p) => (
            <div className="dd__trait" key={p.traitId}>
              <span>{p.traitName}</span>
              <strong>{p.variant.name}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="dd__row">
        <span>DNA</span>
        <CopyField value={combo.dna} />
      </div>
    </>
  );
}
