// Tiny external store for app-level overlays (the AI assistant dock and the
// Settings modal) so any component can open them without prop drilling — same
// pattern as profile.ts / ui.tsx. The assistant needs to deep-link into
// Settings → Assistant when no LLM key is connected, hence a shared store.

import { useEffect, useState } from "react";

export type SettingsSection = "profile" | "assistant" | "appearance" | "about" | "license";

interface PanelState {
  assistant: boolean;
  settings: boolean;
  settingsSection: SettingsSection;
}

let state: PanelState = { assistant: false, settings: false, settingsSection: "profile" };
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function openAssistant() {
  state = { ...state, assistant: true };
  emit();
}
export function closeAssistant() {
  state = { ...state, assistant: false };
  emit();
}
export function openSettings(section: SettingsSection = "profile") {
  state = { ...state, settings: true, settingsSection: section };
  emit();
}
export function closeSettings() {
  state = { ...state, settings: false };
  emit();
}

export function usePanels(): PanelState {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((x) => x + 1);
    subs.add(s);
    return () => {
      subs.delete(s);
    };
  }, []);
  return state;
}
