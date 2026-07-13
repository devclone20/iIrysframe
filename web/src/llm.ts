// Universal LLM bridge — talk to a Neural Soul with ANY provider the user has
// a key for: Anthropic, OpenAI, Google, xAI, DeepSeek, Groq, OpenRouter, or a
// custom OpenAI-compatible endpoint. Keys are BYO: entered at runtime, kept in
// this browser's localStorage only, sent solely to the chosen provider over TLS.

export type Protocol = "anthropic" | "openai" | "google";

export interface Provider {
  id: string;
  label: string;
  protocol: Protocol;
  baseUrl: string;
  models: string[]; // suggestions — a free-text model id is always allowed
  keyHint: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    keyHint: "sk-ant-…",
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-5.2", "gpt-5-mini", "gpt-4.1"],
    keyHint: "sk-…",
  },
  {
    id: "google",
    label: "Google Gemini",
    protocol: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: ["gemini-3-pro", "gemini-3-flash", "gemini-2.5-pro"],
    keyHint: "AIza…",
  },
  {
    id: "xai",
    label: "xAI Grok",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-5", "grok-4.5"],
    keyHint: "xai-…",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    keyHint: "sk-…",
  },
  {
    id: "groq",
    label: "Groq",
    protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-4-70b", "mixtral-9x24b"],
    keyHint: "gsk_…",
  },
  {
    id: "openrouter",
    label: "OpenRouter (any model)",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-opus-4.8", "openai/gpt-5.2", "meta-llama/llama-4-70b"],
    keyHint: "sk-or-…",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    protocol: "openai",
    baseUrl: "",
    models: [],
    keyHint: "your key",
  },
];

// ── key + prefs storage (local only) ─────────────────────────────────────────
const KEYS = "iirys.llm.keys.v1";
const PREFS = "iirys.llm.prefs.v1";

interface LlmPrefs {
  provider: string;
  model: string;
  customBaseUrl: string;
}

export function getKey(providerId: string): string {
  try {
    const all = JSON.parse(localStorage.getItem(KEYS) ?? "{}");
    return typeof all[providerId] === "string" ? all[providerId] : "";
  } catch {
    return "";
  }
}

export function setKey(providerId: string, key: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEYS) ?? "{}");
    if (key.trim()) all[providerId] = key.trim();
    else delete all[providerId];
    localStorage.setItem(KEYS, JSON.stringify(all));
  } catch {
    /* storage blocked */
  }
}

export function getPrefs(): LlmPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
    return {
      provider: typeof p.provider === "string" ? p.provider : "anthropic",
      model: typeof p.model === "string" ? p.model : "",
      customBaseUrl: typeof p.customBaseUrl === "string" ? p.customBaseUrl : "",
    };
  } catch {
    return { provider: "anthropic", model: "", customBaseUrl: "" };
  }
}

export function setPrefs(p: Partial<LlmPrefs>): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...getPrefs(), ...p }));
  } catch {
    /* ignore */
  }
}

// ── chat ─────────────────────────────────────────────────────────────────────
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type LlmErrorKind = "auth" | "rate" | "refusal" | "network" | "api";
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  constructor(message: string, kind: LlmErrorKind = "api") {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
  }
}

export interface StreamOpts {
  providerId: string;
  model: string;
  system: string;
  history: ChatMessage[];
  temperature?: number;
  customBaseUrl?: string;
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

/** Anthropic Opus/Fable families reject `temperature`; Sonnet/Haiku accept it. */
const anthropicAcceptsTemp = (model: string) => /sonnet|haiku/.test(model);

export async function streamChat(opts: StreamOpts): Promise<string> {
  const provider = PROVIDERS.find((p) => p.id === opts.providerId);
  if (!provider) throw new LlmError("Unknown provider.", "api");
  const key = getKey(provider.id);
  if (!key) throw new LlmError(`No ${provider.label} key connected.`, "auth");
  const baseUrl = provider.id === "custom" ? (opts.customBaseUrl ?? "").replace(/\/$/, "") : provider.baseUrl;
  if (!baseUrl) throw new LlmError("Set the custom endpoint base URL.", "api");

  if (provider.protocol === "anthropic") return streamAnthropic(baseUrl, key, opts);
  if (provider.protocol === "google") return streamGoogle(baseUrl, key, opts);
  return streamOpenAI(baseUrl, key, opts);
}

async function readSse(
  res: Response,
  onData: (json: any) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          onData(JSON.parse(data));
        } catch {
          /* partial frame */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function guardResponse(res: Response, providerLabel: string): Promise<void> {
  if (res.ok && res.body) return;
  let detail = "";
  try {
    const j = await res.json();
    detail = j?.error?.message ?? j?.message ?? "";
  } catch {
    /* not json */
  }
  if (res.status === 401 || res.status === 403) throw new LlmError(`Invalid ${providerLabel} key.`, "auth");
  if (res.status === 429) throw new LlmError("Rate limited — try again in a moment.", "rate");
  throw new LlmError(detail || `${providerLabel} error (${res.status}).`, "api");
}

async function streamAnthropic(baseUrl: string, key: string, o: StreamOpts): Promise<string> {
  const body: Record<string, unknown> = {
    model: o.model,
    max_tokens: 2048,
    stream: true,
    system: o.system,
    messages: o.history,
  };
  if (anthropicAcceptsTemp(o.model) && typeof o.temperature === "number") body.temperature = o.temperature;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal: o.signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    throw new LlmError("Network error reaching Anthropic.", "network");
  }
  await guardResponse(res, "Anthropic");
  let full = "";
  let stop: string | null = null;
  await readSse(res, (evt) => {
    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
      full += evt.delta.text;
      o.onText(evt.delta.text);
    } else if (evt.type === "message_delta" && evt.delta?.stop_reason) {
      stop = evt.delta.stop_reason;
    } else if (evt.type === "error") {
      throw new LlmError(evt.error?.message || "Stream error.", "api");
    }
  });
  if (stop === "refusal") throw new LlmError("The agent declined this request.", "refusal");
  return full;
}

async function streamOpenAI(baseUrl: string, key: string, o: StreamOpts): Promise<string> {
  const body: Record<string, unknown> = {
    model: o.model,
    stream: true,
    messages: [{ role: "system", content: o.system }, ...o.history],
  };
  if (typeof o.temperature === "number") body.temperature = o.temperature;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: o.signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    throw new LlmError("Network error reaching the provider (CORS-blocked endpoints need OpenRouter or a proxy).", "network");
  }
  await guardResponse(res, "Provider");
  let full = "";
  await readSse(res, (evt) => {
    const delta = evt.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      full += delta;
      o.onText(delta);
    }
  });
  return full;
}

async function streamGoogle(baseUrl: string, key: string, o: StreamOpts): Promise<string> {
  const contents = o.history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const body: Record<string, unknown> = {
    contents,
    systemInstruction: { parts: [{ text: o.system }] },
    generationConfig: typeof o.temperature === "number" ? { temperature: o.temperature } : {},
  };
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/models/${encodeURIComponent(o.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: o.signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    throw new LlmError("Network error reaching Google.", "network");
  }
  await guardResponse(res, "Google");
  let full = "";
  await readSse(res, (evt) => {
    const t = evt.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    if (t) {
      full += t;
      o.onText(t);
    }
  });
  return full;
}
