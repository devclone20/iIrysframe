import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSoul } from "../soulStore";
import { useCollection } from "../collection";
import {
  SOUL_PRESETS,
  SOUL_PRESET_NAMES,
  SOUL_MODELS,
  buildAiSoul,
  soulAttributes,
  soulReady,
  soulToMarkdown,
  type SoulConfig,
} from "../soul";
import {
  streamAgentReply,
  hasApiKey,
  setApiKey,
  clearApiKey,
  AgentChatError,
  type ChatMessage,
} from "../agentChat";
import { CopyField, toast } from "../ui";

/** Presets that ship a canonical `neural_soul-<name>.md` in /public/souls. */
const FILE_PRESETS = new Set(["iCLONE", "VEGETA", "GOKU"]);

export function Soul({ goEngine }: { goEngine: () => void }) {
  const { soul, setSoul, patch } = useSoul();
  const coll = useCollection();

  const ready = soulReady(soul);
  const preview = useMemo(() => JSON.stringify(buildAiSoul(soul, 1, soul.memoryAnchor), null, 2), [soul]);
  const attrs = useMemo(() => (ready ? soulAttributes(soul) : []), [soul, ready]);

  function exportMd() {
    const md = soulToMarkdown(soul);
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `neural_soul${soul.name ? "-" + soul.name.toLowerCase() : ""}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("neural_soul.md exported", "ok");
  }

  return (
    <section className="view">
      <div className="rail">
        <Stat label="Active soul" value={soul.name || "—"} sub={ready ? "goes to the NFT" : "incomplete"} />
        <Stat label="Preset" value={soul.preset} sub="soul base" />
        <Stat label="Model" value={modelLabel(soul.baseModel)} sub="agent LLM" />
        <Stat label="Collection" value={coll.staged?.collection || "—"} sub={coll.staged ? "queued" : "build in Engine"} />
      </div>

      <div className="soul">
        {/* ── editor ── */}
        <article className="panel">
          <header className="panel__head">
            <h2>
              <span className="step">◉</span> Neural Soul
            </h2>
            <span className="panel__hint">neural_soul.md</span>
          </header>
          <p className="folder-legend">
            The soul defines the AI agent's <strong>identity + behavior</strong>. It is written into the NFT metadata —
            whoever holds the token controls the soul.
          </p>

          <div className="soul-presets">
            {SOUL_PRESET_NAMES.map((p) => (
              <button
                key={p}
                className={`soul-preset ${soul.preset === p ? "is-active" : ""}`}
                onClick={() => setSoul({ ...SOUL_PRESETS[p] })}
              >
                {p === "iCLONE" ? "⬡" : p === "VEGETA" ? "♛" : p === "GOKU" ? "★" : "✎"} {p}
              </button>
            ))}
          </div>

          <div className="field">
            <label>Soul / agent name</label>
            <input value={soul.name} onChange={(e) => patch({ name: e.target.value, preset: "Custom" })} placeholder="iCLONE" />
          </div>
          <div className="field">
            <label>Personality <em>(trait)</em></label>
            <input value={soul.personality} onChange={(e) => patch({ personality: e.target.value })} placeholder="Visionary · builder" />
          </div>
          <div className="form">
            <div className="field">
              <label>Base model (LLM)</label>
              <select value={soul.baseModel} onChange={(e) => patch({ baseModel: e.target.value })}>
                {SOUL_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Temperature · <strong>{soul.temperature.toFixed(2)}</strong></label>
              <input type="range" min={0} max={1} step={0.05} value={soul.temperature} onChange={(e) => patch({ temperature: Number(e.target.value) })} />
            </div>
          </div>
          <div className="field">
            <label>System prompt <em>(agent behavior)</em></label>
            <textarea rows={5} value={soul.systemPrompt} onChange={(e) => patch({ systemPrompt: e.target.value })} placeholder="You are a digital guardian. You answer coldly and logically." />
          </div>
          <div className="form">
            <div className="field">
              <label>Voice <em>(optional)</em></label>
              <input value={soul.voice} onChange={(e) => patch({ voice: e.target.value })} placeholder="calm, precise" />
            </div>
            <div className="field">
              <label>Memory anchor <em>(URL, optional)</em></label>
              <input value={soul.memoryAnchor} onChange={(e) => patch({ memoryAnchor: e.target.value })} placeholder="https://gateway.irys.xyz/…" />
            </div>
          </div>
        </article>

        {/* ── live ai_soul + status ── */}
        <article className="panel">
          <header className="panel__head">
            <h2>
              <span className="step">⌘</span> ai_soul · metadata
            </h2>
            <span className={`soul-badge ${ready ? "is-on" : "is-off"}`}>{ready ? "will attach ✓" : "incomplete"}</span>
          </header>

          <p className="folder-legend">
            This object is injected into <code>metadata.ai_soul</code> of <strong>every NFT</strong> when you seal on the iIrys tab.
          </p>

          <pre className="soul-json">{preview}</pre>

          {attrs.length > 0 && (
            <div className="soul-attrs">
              {attrs.map((a) => (
                <span className="soul-attr" key={a.trait_type}>
                  <em>{a.trait_type}</em> {a.value}
                </span>
              ))}
            </div>
          )}

          <div className="soul-keylink">
            <span className="soul-keylink__label">system_prompt (quick copy)</span>
            <CopyField value={soul.systemPrompt || "—"} />
          </div>

          <div className="soul-actions">
            <button
              className="btn btn--ghost btn--mini"
              onClick={() =>
                document.getElementById("agent-console")?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              disabled={!ready}
            >
              💬 Talk to the agent ↓
            </button>
            <button className="btn btn--ghost btn--mini" onClick={exportMd}>⬇ Export neural_soul.md</button>
            <button className="btn btn--primary btn--mini" onClick={goEngine} disabled={!ready}>
              {ready ? "Generate collection →" : "Complete the soul first"}
            </button>
          </div>

          <div className="soul-flow">
            <strong>Flow:</strong> Soul → <span className="ov">Engine</span> (art + traits) → <span className="ov">iIrys</span> (seals image + metadata w/ <code>ai_soul</code> → tokenURI) → <span className="ov">Mint</span> on Base. The agent runtime reads the tokenURI and boots the agent from <code>ai_soul</code>.
          </div>
        </article>
      </div>

      {/* ── live agent console: chat with the agent · read the full soul ── */}
      <AgentConsole soul={soul} ready={ready} />
    </section>
  );
}

/** The console below the editor: a live chat with the agent (powered by the
 *  soul's own system prompt + model) and a tab to read the full neural_soul.md.
 *  Default tab is the chat — this is where the holder *interacts* with the agent. */
function AgentConsole({ soul, ready }: { soul: SoulConfig; ready: boolean }) {
  const [tab, setTab] = useState<"chat" | "doc">("chat");
  const agentName = soul.name || soul.preset;

  return (
    <article className="panel agent-console" id="agent-console">
      <header className="panel__head">
        <h2>
          <span className="step">◆</span> Agent console
        </h2>
        <div className="console-tabs">
          <button className={tab === "chat" ? "is-active" : ""} onClick={() => setTab("chat")}>
            <span className="live-dot" /> Chat
          </button>
          <button className={tab === "doc" ? "is-active" : ""} onClick={() => setTab("doc")}>
            neural_soul.md
          </button>
        </div>
      </header>
      <p className="folder-legend">
        Talk to <strong>{agentName}</strong> live — powered by its own soul (system prompt + {modelLabel(soul.baseModel)}) —
        or read the full <em>neural_soul.md</em>. This is where you test <em>who</em> the agent is before sealing it into the NFT.
      </p>
      {tab === "chat" ? <AgentChat soul={soul} ready={ready} /> : <SoulDocBody soul={soul} />}
    </article>
  );
}

/** Live chat with the active agent. BYO Anthropic key, kept only in localStorage. */
function AgentChat({ soul, ready }: { soul: SoulConfig; ready: boolean }) {
  const agentName = soul.name || soul.preset;
  const [keyReady, setKeyReady] = useState(hasApiKey());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fresh conversation whenever the active agent changes.
  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamText("");
    setStreaming(false);
    setError(null);
    setDraft("");
  }, [soul.preset, soul.name, soul.systemPrompt]);

  // Keep the latest turn in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamText]);

  async function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    if (!soul.systemPrompt.trim()) {
      setError("This soul has no system prompt yet — complete it first.");
      return;
    }
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setStreaming(true);
    setStreamText("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const full = await streamAgentReply({
        soul,
        history: next,
        onText: (d) => setStreamText((s) => s + d),
        signal: ctrl.signal,
      });
      setMessages((m) => [...m, { role: "assistant", content: full }]);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") {
        // user stopped — drop the partial, leave the conversation intact
      } else if (e instanceof AgentChatError && e.kind === "auth") {
        clearApiKey();
        setKeyReady(false);
        setError("Invalid key — connect another to continue.");
      } else {
        setError(e instanceof Error ? e.message : "Error talking to the agent.");
      }
    } finally {
      setStreaming(false);
      setStreamText("");
      abortRef.current = null;
    }
  }

  if (!keyReady) {
    return <KeyGate agentName={agentName} onReady={() => setKeyReady(true)} />;
  }

  return (
    <div className="agent-chat">
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && !streaming && (
          <div className="chat-empty">
            <p>
              You're talking to <strong>{agentName}</strong>
              {soul.personality ? <> · {soul.personality}</> : null}.
            </p>
            <p className="chat-empty__hint">
              {ready
                ? "Say hi, or ask it for something within its vocation."
                : "Complete the soul (name + system prompt) for a faithful reply."}
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role} text={m.content} agentName={agentName} />
        ))}
        {streaming && <ChatBubble role="assistant" text={streamText} agentName={agentName} pending />}
        {error && <p className="chat-error">⚠ {error}</p>}
      </div>

      <div className="chat-input">
        <textarea
          rows={1}
          value={draft}
          placeholder={`Message ${agentName}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {streaming ? (
          <button className="btn btn--ghost btn--mini" onClick={() => abortRef.current?.abort()}>
            stop
          </button>
        ) : (
          <button className="btn btn--primary btn--mini" onClick={send} disabled={!draft.trim()}>
            send ↵
          </button>
        )}
      </div>

      <div className="chat-foot">
        <span>
          {modelLabel(soul.baseModel)} · key stays <strong>in your browser only</strong>
        </span>
        <button
          className="chat-keybtn"
          onClick={() => {
            clearApiKey();
            setKeyReady(false);
          }}
        >
          change key
        </button>
      </div>
    </div>
  );
}

function ChatBubble({
  role,
  text,
  agentName,
  pending,
}: {
  role: "user" | "assistant";
  text: string;
  agentName: string;
  pending?: boolean;
}) {
  return (
    <div className={`bubble bubble--${role}`}>
      <span className="bubble__who">{role === "user" ? "you" : agentName}</span>
      <div className="bubble__body">
        {role === "assistant" ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || "…"}</ReactMarkdown>
        ) : (
          text
        )}
        {pending && <span className="bubble__caret" />}
      </div>
    </div>
  );
}

/** First-run gate: connect a BYO Anthropic key (stored only in this browser). */
function KeyGate({ agentName, onReady }: { agentName: string; onReady: () => void }) {
  const [val, setVal] = useState("");
  const valid = val.trim().startsWith("sk-");
  function connect() {
    if (!valid) return;
    setApiKey(val);
    onReady();
  }
  return (
    <div className="key-gate">
      <p className="key-gate__title">
        Connect an Anthropic key to talk to <strong>{agentName}</strong>
      </p>
      <p className="key-gate__sub">
        The key is yours. It is stored <strong>in this browser only</strong> (localStorage) and goes solely to Anthropic —
        it never passes through our server.
      </p>
      <div className="key-gate__row">
        <input
          type="password"
          value={val}
          placeholder="sk-ant-…"
          autoComplete="off"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") connect();
          }}
        />
        <button className="btn btn--primary btn--mini" disabled={!valid} onClick={connect}>
          connect
        </button>
      </div>
      <p className="key-gate__link">
        No key?{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          console.anthropic.com
        </a>
      </p>
    </div>
  );
}

/** The iIrys Frame document viewer. Shows the active soul's full `neural_soul.md`
 *  (iCLONE / VEGETA / GOKU load their canonical file from /souls; Custom falls back
 *  to the markdown generated from the live fields) and the shared
 *  `NEURAL_SOUL_ARCHITECTURE.md` skeleton that every soul is built on. */
function SoulDocBody({ soul }: { soul: SoulConfig }) {
  const isFilePreset = FILE_PRESETS.has(soul.preset);
  const [view, setView] = useState<"soul" | "architecture">("soul");
  const [fileMd, setFileMd] = useState<string | null>(null);
  const [archMd, setArchMd] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // active soul's canonical file
  useEffect(() => {
    if (!isFilePreset) {
      setFileMd(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const url = `${import.meta.env.BASE_URL}souls/neural_soul-${soul.preset.toLowerCase()}.md`;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => !cancelled && setFileMd(t))
      .catch(() => !cancelled && setFileMd(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [soul.preset, isFilePreset]);

  // shared architecture skeleton — fetched once, the first time it's viewed
  useEffect(() => {
    if (view !== "architecture" || archMd != null) return;
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}souls/NEURAL_SOUL_ARCHITECTURE.md`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => !cancelled && setArchMd(t))
      .catch(() => !cancelled && setArchMd("_Could not load NEURAL_SOUL_ARCHITECTURE.md._"));
    return () => {
      cancelled = true;
    };
  }, [view, archMd]);

  const fromFile = isFilePreset && fileMd != null;
  const soulMd = useMemo(() => (fromFile ? (fileMd as string) : soulToMarkdown(soul)), [fromFile, fileMd, soul]);
  const isArch = view === "architecture";
  const showLoading = isArch ? archMd == null : loading && !fromFile;
  const md = isArch ? archMd ?? "" : soulMd;
  const meta = isArch ? "shared skeleton · every soul" : fromFile ? "full soul · canonical" : "generated from fields";

  return (
    <>
      <div className="doc-switch">
        <button className={!isArch ? "is-active" : ""} onClick={() => setView("soul")}>
          {soul.name || soul.preset} · soul
        </button>
        <button className={isArch ? "is-active" : ""} onClick={() => setView("architecture")}>
          ◇ architecture
        </button>
        <span className="console-doc-meta">{meta}</span>
      </div>
      <div className="soul-doc-body">
        {showLoading ? (
          <p className="soul-doc-empty">loading…</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
        )}
      </div>
    </>
  );
}

function modelLabel(id: string): string {
  return SOUL_MODELS.find((m) => m.id === id)?.label ?? id;
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value stat__value--sm">{value}</span>
      <span className="stat__sub">{sub}</span>
    </div>
  );
}
