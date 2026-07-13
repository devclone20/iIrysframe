import { useEffect, useRef, useState } from "react";
import { useWizard } from "../wizard/wizardStore";
import { PROVIDERS, getKey, setKey, getPrefs, setPrefs, streamChat, LlmError, type ChatMessage } from "../llm";
import { toast } from "../ui";
import { STEP_META, STEP_IDS } from "../wizard/wizardStore";

/** Test environment: learn how the platform works and talk to any soul with
 *  ANY LLM provider you hold a key for. Nothing here touches the chain. */
export function Playground() {
  return (
    <section className="view">
      <div className="forge">
        <div className="forge__col">
          <HowItWorks />
        </div>
        <div className="forge__col">
          <SoulChat />
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <article className="panel">
      <header className="panel__head">
        <h2>How it works</h2>
        <span className="panel__hint">test environment — nothing on-chain</span>
      </header>
      <p className="folder-legend">
        iIrys Frame takes you from raw art to a launched iNFT collection in one guided path. Each iNFT is an{" "}
        <strong>agent</strong>: art + metadata + a Neural Soul, sealed forever on the Irys datachain, minted on your own
        Base contract, indexed by OpenSea.
      </p>
      <div className="how-steps">
        {STEP_IDS.map((id, i) => (
          <div className="how-step" key={id}>
            <span className="step">{i + 1}</span>
            <div>
              <strong>{STEP_META[id].label}</strong>
              <p>{HOW_DETAIL[id]}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="e3d__soulhint">
        The whole flow lives in <strong>Create</strong>. The sealed result lands in <strong>Launch</strong> (mint +
        OpenSea) and your on-chain inventory in <strong>Vault</strong>. There is no platform limit on items — the only
        limit is the storage + gas you choose to pay.
      </p>
    </article>
  );
}

const HOW_DETAIL: Record<string, string> = {
  type: "Choose 2D or 3D, and whether it's a full collection, a single item, or trait layers that generate a collection.",
  launch: "Mint here and let OpenSea index it, or prepare a drop for OpenSea's own console.",
  contract: "Your ERC-721A contract with perpetual royalties, supply caps, public mint price, per-wallet limits and an optional OG-card gate — deployed from your wallet, on Base, in one transaction.",
  upload: "Drop the models or images. 3D accepts rigged FBX/GLB — animation survives the whole pipeline.",
  souls: "Create as many souls as you want with the + button; embed one across the collection or mix them randomly per item. Whoever holds the token controls the soul.",
  naming: "Name the collection and pick how items are named: prefix + number, random IDs, curated name sets, or ranked by rarity.",
  process: "3D models are compressed ~90% with the animation intact and get an auto-captured poster; rarity tiers distribute by your percentages.",
  seal: "Everything is written permanently to Irys — art, metadata, souls and a drop manifest. Under 100 KiB is free; the rest is paid once, in Base ETH.",
};

function SoulChat() {
  const wiz = useWizard();
  const [soulId, setSoulId] = useState(wiz.souls[0]?.id ?? "");
  const soul = wiz.souls.find((s) => s.id === soulId) ?? wiz.souls[0];

  const prefs = getPrefs();
  const [providerId, setProviderId] = useState(prefs.provider);
  const provider = PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0]!;
  const [model, setModel] = useState(prefs.model || provider.models[0] || "");
  const [customBase, setCustomBase] = useState(prefs.customBaseUrl);
  const [keyDraft, setKeyDraft] = useState("");
  const [hasKey, setHasKey] = useState(!!getKey(providerId));

  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streamText, setStreamText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHasKey(!!getKey(providerId));
    const p = PROVIDERS.find((x) => x.id === providerId);
    if (p && p.models.length && !p.models.includes(model)) setModel(p.models[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history, streamText]);

  async function send() {
    const text = draft.trim();
    if (!text || streamText !== null || !soul) return;
    setError(null);
    setDraft("");
    const next: ChatMessage[] = [...history, { role: "user", content: text }];
    setHistory(next);
    setStreamText("");
    setPrefs({ provider: providerId, model, customBaseUrl: customBase });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const full = await streamChat({
        providerId,
        model,
        system: soul.systemPrompt,
        history: next,
        temperature: soul.temperature,
        customBaseUrl: customBase,
        onText: (d) => setStreamText((t) => (t ?? "") + d),
        signal: ctrl.signal,
      });
      setHistory((h) => [...h, { role: "assistant", content: full }]);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") {
        /* user stopped */
      } else if (e instanceof LlmError) {
        setError(e.message);
        if (e.kind === "auth") setHasKey(false);
      } else {
        setError(String((e as Error)?.message ?? e));
      }
    } finally {
      setStreamText(null);
      abortRef.current = null;
    }
  }

  return (
    <article className="panel">
      <header className="panel__head">
        <h2>Talk to a soul</h2>
        <span className="panel__hint">your key · your model · local only</span>
      </header>

      <div className="form">
        <div className="field">
          <label>Soul</label>
          <select value={soul?.id ?? ""} onChange={(e) => { setSoulId(e.target.value); setHistory([]); }}>
            {wiz.souls.map((s, i) => (
              <option key={s.id} value={s.id}>{s.name || s.preset || `Soul ${i + 1}`}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Provider</label>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form">
        <div className="field">
          <label>Model</label>
          <input list={`models-${provider.id}`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" />
          <datalist id={`models-${provider.id}`}>
            {provider.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        {provider.id === "custom" ? (
          <div className="field">
            <label>Base URL (OpenAI-compatible)</label>
            <input value={customBase} onChange={(e) => setCustomBase(e.target.value)} placeholder="https://my-endpoint/v1" />
          </div>
        ) : (
          <div className="field">
            <label>API key {hasKey && <em>connected</em>}</label>
            <div className="wp__fund-row" style={{ margin: 0 }}>
              <input type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={hasKey ? "•••••••• (saved locally)" : provider.keyHint} />
              <button className="btn btn--mini" onClick={() => { setKey(providerId, keyDraft); setHasKey(!!keyDraft); setKeyDraft(""); toast(keyDraft ? "Key saved locally" : "Key cleared", "ok"); }}>
                Save
              </button>
            </div>
          </div>
        )}
      </div>
      {provider.id === "custom" && (
        <div className="field">
          <label>API key</label>
          <div className="wp__fund-row" style={{ margin: 0 }}>
            <input type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={hasKey ? "•••••••• (saved locally)" : "key"} />
            <button className="btn btn--mini" onClick={() => { setKey(providerId, keyDraft); setHasKey(!!keyDraft); setKeyDraft(""); toast("Key saved locally", "ok"); }}>
              Save
            </button>
          </div>
        </div>
      )}

      <div className="chat-scroll" ref={scrollRef} style={{ height: 320, marginTop: 12 }}>
        {history.length === 0 && streamText === null && (
          <div className="chat-empty">
            <strong>{soul?.name || "The soul"}</strong> is listening.
            <div className="chat-empty__hint">Ask it who it is, what it can do, how it will act for its holder — this is the same soul that gets sealed into the iNFT.</div>
          </div>
        )}
        {history.map((m, i) => (
          <div className={`bubble bubble--${m.role}`} key={i}>
            <span className="bubble__who">{m.role === "user" ? "you" : soul?.name || "soul"}</span>
            <div className="bubble__body">{m.content}</div>
          </div>
        ))}
        {streamText !== null && (
          <div className="bubble bubble--assistant">
            <span className="bubble__who">{soul?.name || "soul"}</span>
            <div className="bubble__body">
              {streamText}
              <span className="bubble__caret" />
            </div>
          </div>
        )}
      </div>
      {error && <p className="chat-error">{error}</p>}
      <div className="chat-input" style={{ marginTop: 10 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={hasKey || provider.id === "custom" ? `Message ${soul?.name || "the soul"}…` : `Save a ${provider.label} key above to start`}
        />
        {streamText !== null ? (
          <button className="btn" onClick={() => abortRef.current?.abort()}>Stop</button>
        ) : (
          <button className="btn btn--primary" onClick={() => void send()} disabled={!draft.trim()}>Send</button>
        )}
      </div>
    </article>
  );
}
