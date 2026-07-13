import { useEffect, useRef, useState } from "react";
import { PROVIDERS, getKey, getPrefs, streamChat, LlmError, type ChatMessage } from "../llm";
import { ASSISTANT_SYSTEM, ASSISTANT_GREETING } from "../assistant";
import { usePanels, openAssistant, closeAssistant, openSettings } from "../panels";

/** The always-available iIrys support assistant. Runs on the user's own LLM
 *  (Settings → Assistant), streams answers about every part of the app, and
 *  keeps its transcript for the session. Opens from the user popover or its own
 *  floating button; deep-links to Settings when no key is connected. */
export function AssistantDock() {
  const panels = usePanels();
  return (
    <>
      <button
        className={`assistant-fab ${panels.assistant ? "is-open" : ""}`}
        onClick={() => (panels.assistant ? closeAssistant() : openAssistant())}
        aria-label="iIrys assistant"
        title="iIrys assistant"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M4 5.5h16v10H8.5L4 19V5.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 9.2h8M8 12h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {panels.assistant && <AssistantPanel />}
    </>
  );
}

function AssistantPanel() {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streamText, setStreamText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // re-read key/prefs after Settings edits
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const prefs = getPrefs();
  const provider = PROVIDERS.find((p) => p.id === prefs.provider) ?? PROVIDERS[0]!;
  const connected = provider.id === "custom" ? !!prefs.customBaseUrl && !!getKey(provider.id) : !!getKey(provider.id);
  void tick;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history, streamText]);

  useEffect(() => {
    const onFocus = () => setTick((x) => x + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  async function send() {
    const text = draft.trim();
    if (!text || streamText !== null) return;
    if (!connected) {
      openSettings("assistant");
      return;
    }
    setError(null);
    setDraft("");
    const next: ChatMessage[] = [...history, { role: "user", content: text }];
    setHistory(next);
    setStreamText("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const full = await streamChat({
        providerId: prefs.provider,
        model: prefs.model || provider.models[0] || "",
        system: ASSISTANT_SYSTEM,
        history: next,
        temperature: 0.4,
        customBaseUrl: prefs.customBaseUrl,
        onText: (d) => setStreamText((t) => (t ?? "") + d),
        signal: ctrl.signal,
      });
      setHistory((h) => [...h, { role: "assistant", content: full }]);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") {
        /* stopped */
      } else if (e instanceof LlmError) {
        setError(e.message);
      } else {
        setError(String((e as Error)?.message ?? e));
      }
    } finally {
      setStreamText(null);
      abortRef.current = null;
    }
  }

  return (
    <>
      <div className="assistant-scrim" onClick={() => closeAssistant()} />
      <div className="assistant" role="dialog" aria-label="iIrys assistant">
        <header className="assistant__head">
          <span className="assistant__dot" />
          <div className="assistant__title">
            <strong>iIrys</strong>
            <span>assistant · {connected ? provider.label : "not connected"}</span>
          </div>
          <button className="assistant__x" onClick={() => closeAssistant()} aria-label="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="assistant__scroll chat-scroll" ref={scrollRef}>
          <div className="bubble bubble--assistant">
            <span className="bubble__who">iIrys</span>
            <div className="bubble__body">{ASSISTANT_GREETING}</div>
          </div>
          {history.map((m, i) => (
            <div className={`bubble bubble--${m.role}`} key={i}>
              <span className="bubble__who">{m.role === "user" ? "you" : "iIrys"}</span>
              <div className="bubble__body">{m.content}</div>
            </div>
          ))}
          {streamText !== null && (
            <div className="bubble bubble--assistant">
              <span className="bubble__who">iIrys</span>
              <div className="bubble__body">
                {streamText}
                <span className="bubble__caret" />
              </div>
            </div>
          )}
        </div>

        {!connected && (
          <div className="assistant__connect">
            Connect your LLM to turn on support.
            <button className="btn btn--mini" onClick={() => openSettings("assistant")}>Connect in Settings</button>
          </div>
        )}
        {error && <p className="chat-error">{error}</p>}

        <div className="assistant__input">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={connected ? "Ask about sealing, minting, royalties, agents…" : "Connect an LLM in Settings to start"}
          />
          {streamText !== null ? (
            <button className="btn" onClick={() => abortRef.current?.abort()}>Stop</button>
          ) : (
            <button className="btn btn--primary" onClick={() => void send()} disabled={!draft.trim()}>Send</button>
          )}
        </div>
      </div>
    </>
  );
}
