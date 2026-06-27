// Live bridge to talk to a Neural Soul agent from the browser, using the
// Anthropic Messages API. The soul (system_prompt + model) drives the agent;
// the holder talks to it before sealing it into the NFT.
//
// SECURITY: the API key is the holder's own. It is entered at runtime, kept only
// in this browser's localStorage, and sent solely to api.anthropic.com over TLS.
// It is never bundled, never logged, and never reaches our servers.

import type { SoulConfig } from "./soul";

const KEY_STORAGE = "iirys.anthropic_key";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE)?.trim() ?? "";
  } catch {
    return "";
  }
}
export function setApiKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, key.trim());
  } catch {
    /* storage blocked — ignore */
  }
}
export function clearApiKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignore */
  }
}
export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ChatErrorKind = "auth" | "rate" | "refusal" | "network" | "api";
export class AgentChatError extends Error {
  readonly kind: ChatErrorKind;
  constructor(message: string, kind: ChatErrorKind = "api") {
    super(message);
    this.name = "AgentChatError";
    this.kind = kind;
  }
}

/** `temperature` is rejected (400) by the Opus 4.8/4.7 and Fable families;
 *  only the Sonnet/Haiku models still accept a sampling temperature. */
function acceptsTemperature(model: string): boolean {
  return /sonnet|haiku/.test(model);
}

/** Stream a reply from the agent defined by `soul`. Invokes `onText` with each
 *  text delta and resolves with the full assistant message. Throws on failure
 *  (AgentChatError) or abort (DOMException "AbortError"). */
export async function streamAgentReply(opts: {
  soul: SoulConfig;
  history: ChatMessage[];
  onText: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const key = getApiKey();
  if (!key) throw new AgentChatError("No Anthropic key connected.", "auth");

  const { soul, history, onText, signal } = opts;
  const model = soul.baseModel || "claude-opus-4-8";

  const body: Record<string, unknown> = {
    model,
    max_tokens: 2048,
    stream: true,
    system: soul.systemPrompt,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  };
  if (acceptsTemperature(model) && typeof soul.temperature === "number") {
    body.temperature = soul.temperature;
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION,
        // Officially-supported opt-in for calling the API directly from a browser.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    throw new AgentChatError("Network error reaching Anthropic.", "network");
  }

  if (!res.ok || !res.body) {
    let detail = "";
    try {
      detail = (await res.json())?.error?.message ?? "";
    } catch {
      /* body not JSON — ignore */
    }
    if (res.status === 401) throw new AgentChatError("Invalid Anthropic key.", "auth");
    if (res.status === 429) throw new AgentChatError("Rate limited — try again in a moment.", "rate");
    throw new AgentChatError(detail || `Anthropic API error (${res.status}).`, "api");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let stopReason: string | null = null;

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
        let evt: {
          type?: string;
          delta?: { type?: string; text?: string; stop_reason?: string };
          error?: { message?: string };
        };
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
          full += evt.delta.text;
          onText(evt.delta.text);
        } else if (evt.type === "message_delta" && evt.delta?.stop_reason) {
          stopReason = evt.delta.stop_reason;
        } else if (evt.type === "error") {
          throw new AgentChatError(evt.error?.message || "Stream error.", "api");
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (stopReason === "refusal") {
    throw new AgentChatError("The agent declined this request.", "refusal");
  }
  return full;
}
