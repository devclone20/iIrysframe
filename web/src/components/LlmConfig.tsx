import { useEffect, useState } from "react";
import { PROVIDERS, getKey, setKey, getPrefs, setPrefs } from "../llm";
import { toast } from "../ui";

/** Shared LLM connection editor — provider, model, and a BYO key kept only in
 *  this browser's localStorage (via llm.ts). Used by Settings → Assistant so a
 *  single connection powers the whole app's AI support. */
export function LlmConfig({ onChange }: { onChange?: () => void }) {
  const prefs = getPrefs();
  const [providerId, setProviderId] = useState(prefs.provider);
  const provider = PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0]!;
  const [model, setModel] = useState(prefs.model || provider.models[0] || "");
  const [customBase, setCustomBase] = useState(prefs.customBaseUrl);
  const [keyDraft, setKeyDraft] = useState("");
  const [hasKey, setHasKey] = useState(!!getKey(providerId));

  useEffect(() => {
    setHasKey(!!getKey(providerId));
    const p = PROVIDERS.find((x) => x.id === providerId);
    const nextModel = p && p.models.length && !p.models.includes(model) ? p.models[0]! : model;
    if (nextModel !== model) setModel(nextModel);
    setPrefs({ provider: providerId, model: nextModel, customBaseUrl: customBase });
    onChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  function persist(next?: { model?: string; customBase?: string }) {
    setPrefs({
      provider: providerId,
      model: next?.model ?? model,
      customBaseUrl: next?.customBase ?? customBase,
    });
    onChange?.();
  }

  function saveKey() {
    setKey(providerId, keyDraft);
    setHasKey(!!keyDraft);
    setKeyDraft("");
    toast(keyDraft ? "Key saved locally" : "Key cleared", "ok");
    onChange?.();
  }

  return (
    <>
      <div className="form">
        <div className="field">
          <label>Provider</label>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Model</label>
          <input
            list={`llmcfg-models-${provider.id}`}
            value={model}
            onChange={(e) => { setModel(e.target.value); persist({ model: e.target.value }); }}
            placeholder="model id"
          />
          <datalist id={`llmcfg-models-${provider.id}`}>
            {provider.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </div>

      {provider.id === "custom" && (
        <div className="field">
          <label>Base URL (OpenAI-compatible)</label>
          <input
            value={customBase}
            onChange={(e) => { setCustomBase(e.target.value); persist({ customBase: e.target.value }); }}
            placeholder="https://my-endpoint/v1"
          />
        </div>
      )}

      <div className="field">
        <label>API key {hasKey && <em>connected</em>}</label>
        <div className="wp__fund-row" style={{ margin: 0 }}>
          <input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }}
            placeholder={hasKey ? "•••••••• (saved locally)" : provider.id === "custom" ? "your key" : provider.keyHint}
          />
          <button className="btn btn--mini" onClick={saveKey}>Save</button>
        </div>
      </div>
    </>
  );
}
