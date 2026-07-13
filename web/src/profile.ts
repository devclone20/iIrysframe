// User profile + appearance, persisted locally. The avatar photo lives here
// (small data-URL) and shows in the top-bar user button and the wallet popover.
// Kept as a tiny external store (same pattern as ui.tsx toasts) so any
// component can read/subscribe without prop drilling.

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

export interface Profile {
  name: string;
  photo: string | null; // data URL (downscaled)
  theme: Theme;
}

const KEY = "iirys.profile.v1";
const DEFAULTS: Profile = { name: "", photo: null, theme: "dark" };

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Profile>;
    return {
      name: typeof p.name === "string" ? p.name : "",
      photo: typeof p.photo === "string" ? p.photo : null,
      theme: p.theme === "light" ? "light" : "dark",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let profile: Profile = load();
const subs = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* storage full (photo too big) — keep in-memory state */
  }
}

export function applyTheme(theme: Theme = profile.theme) {
  document.documentElement.dataset.theme = theme;
}

export function setProfile(patch: Partial<Profile>) {
  profile = { ...profile, ...patch };
  persist();
  if (patch.theme) applyTheme(patch.theme);
  subs.forEach((s) => s());
}

export function getProfile(): Profile {
  return profile;
}

export function useProfile(): Profile {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((x) => x + 1);
    subs.add(s);
    return () => {
      subs.delete(s);
    };
  }, []);
  return profile;
}

/** File → square-cropped, downscaled data URL that fits comfortably in localStorage. */
export function fileToAvatar(file: File, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}
