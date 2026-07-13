import { useEffect, useRef, useState } from "react";
import { fileToAvatar, setProfile, useProfile, type Theme } from "../profile";
import { toast } from "../ui";
import { APP_VERSION } from "../config";
import { usePanels, openSettings, closeSettings, openAssistant, type SettingsSection } from "../panels";
import { LlmConfig } from "./LlmConfig";

type Section = SettingsSection;

const SECTIONS: { key: Section; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "assistant", label: "Assistant" },
  { key: "appearance", label: "Appearance" },
  { key: "about", label: "About" },
  { key: "license", label: "License" },
];

export function SettingsButton() {
  const panels = usePanels();
  return (
    <>
      <button className="settings-fab" onClick={() => openSettings("profile")} aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Zm7.6-3.4c0 .5-.05 1-.14 1.47l2 1.56-1.9 3.3-2.36-.95a7.6 7.6 0 0 1-2.54 1.47L14.3 21.4h-4.6l-.36-2.55a7.6 7.6 0 0 1-2.54-1.47l-2.36.95-1.9-3.3 2-1.56a7.7 7.7 0 0 1 0-2.94l-2-1.56 1.9-3.3 2.36.95A7.6 7.6 0 0 1 9.34 5.2L9.7 2.6h4.6l.36 2.55a7.6 7.6 0 0 1 2.54 1.47l2.36-.95 1.9 3.3-2 1.56c.09.48.14.97.14 1.47Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {panels.settings && <SettingsPanel initialSection={panels.settingsSection} onClose={closeSettings} />}
    </>
  );
}

function SettingsPanel({ initialSection, onClose }: { initialSection: Section; onClose: () => void }) {
  const [section, setSection] = useState<Section>(initialSection);
  useEffect(() => setSection(initialSection), [initialSection]);
  return (
    <div className="modal is-open" role="dialog" aria-label="Settings">
      <div className="modal__scrim" onClick={onClose} />
      <div className="settings">
        <aside className="settings__nav">
          <span className="settings__title">Settings</span>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`settings__navitem ${section === s.key ? "is-active" : ""}`}
              onClick={() => setSection(s.key)}
            >
              {s.label}
            </button>
          ))}
          <span className="settings__ver">iIrys Frame {APP_VERSION}</span>
        </aside>
        <div className="settings__body">
          <button className="settings__close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          {section === "profile" && <ProfileSection />}
          {section === "assistant" && <AssistantSection onClose={onClose} />}
          {section === "appearance" && <AppearanceSection />}
          {section === "about" && <AboutSection />}
          {section === "license" && <LicenseSection />}
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const p = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(file: File | undefined | null) {
    if (!file) return;
    try {
      const photo = await fileToAvatar(file);
      setProfile({ photo });
      toast("Profile photo updated", "ok");
    } catch {
      toast("Could not read that image", "err");
    }
  }

  return (
    <section className="settings__section">
      <h3>Profile</h3>
      <p className="settings__lead">Your photo appears on the user button in the top bar. It stays on this device.</p>
      <div className="settings__avatar-row">
        <span className="settings__avatar">
          {p.photo ? <img src={p.photo} alt="" /> : <UserGlyph size={26} />}
        </span>
        <div className="settings__avatar-actions">
          <button className="btn btn--mini" onClick={() => fileRef.current?.click()}>
            Change photo
          </button>
          {p.photo && (
            <button className="btn btn--ghost btn--mini" onClick={() => setProfile({ photo: null })}>
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <div className="field">
        <label>Display name</label>
        <input
          type="text"
          maxLength={40}
          placeholder="Optional"
          value={p.name}
          onChange={(e) => setProfile({ name: e.target.value })}
        />
      </div>
    </section>
  );
}

function AssistantSection({ onClose }: { onClose: () => void }) {
  return (
    <section className="settings__section">
      <h3>AI Assistant</h3>
      <p className="settings__lead">
        Connect your own LLM to power in-app support. The assistant knows the whole app — sealing on Irys, minting on
        Base, fixing OpenSea media, royalties, linking an NFT to an agent, and the Harness. Your key is stored only in
        this browser and is sent solely to the provider you choose.
      </p>
      <LlmConfig />
      <div className="settings__facts" style={{ marginTop: 18 }}>
        <div className="settings__fact">
          <span>Privacy</span>
          <strong>Key stays in this browser</strong>
        </div>
        <div className="settings__fact">
          <span>Powers</span>
          <strong>Assistant + Playground</strong>
        </div>
      </div>
      <div className="settings__links" style={{ marginTop: 16 }}>
        <button
          className="btn btn--mini"
          onClick={() => {
            openAssistant();
            onClose();
          }}
        >
          Open the assistant
        </button>
      </div>
    </section>
  );
}

function AppearanceSection() {
  const p = useProfile();
  const pick = (theme: Theme) => setProfile({ theme });
  return (
    <section className="settings__section">
      <h3>Appearance</h3>
      <p className="settings__lead">iIrys Frame follows the CLONE FRAME design language — monochrome, editorial, calm.</p>
      <div className="theme-grid">
        {(["dark", "light"] as Theme[]).map((t) => (
          <button key={t} className={`theme-card ${p.theme === t ? "is-active" : ""}`} onClick={() => pick(t)}>
            <span className={`theme-card__preview theme-card__preview--${t}`}>
              <span />
              <span />
              <span />
            </span>
            <span className="theme-card__name">{t === "dark" ? "Dark" : "Light"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AboutSection() {
  return (
    <section className="settings__section">
      <h3>About</h3>
      <p className="settings__lead">
        iIrys Frame is the control surface for a permanent NFT layer vault on Irys — seal layered art, compose finals,
        attach the Neural Soul and metadata, and get the mint-ready link (tokenURI) for Base.
      </p>
      <div className="settings__facts">
        <div className="settings__fact">
          <span>Version</span>
          <strong>{APP_VERSION}</strong>
        </div>
        <div className="settings__fact">
          <span>Network</span>
          <strong>Base (8453), paid in ETH</strong>
        </div>
        <div className="settings__fact">
          <span>Storage</span>
          <strong>Irys datachain, permanent</strong>
        </div>
        <div className="settings__fact">
          <span>Ecosystem</span>
          <strong>CLONE FRAME / iCLONE</strong>
        </div>
      </div>
      <div className="settings__links">
        <a href="https://irys.xyz" target="_blank" rel="noopener noreferrer">
          irys.xyz
        </a>
        <a href="https://basescan.org" target="_blank" rel="noopener noreferrer">
          basescan.org
        </a>
        <a href="https://github.com/devclone20" target="_blank" rel="noopener noreferrer">
          github.com/devclone20
        </a>
      </div>
    </section>
  );
}

function LicenseSection() {
  return (
    <section className="settings__section">
      <h3>MIT License</h3>
      <pre className="settings__license">{MIT_TEXT}</pre>
    </section>
  );
}

export function UserGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="8.6" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.8 20.2c1.3-3.4 4-5.1 7.2-5.1s5.9 1.7 7.2 5.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const MIT_TEXT = `MIT License

Copyright (c) 2026 CLONE FRAME (devclone20)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
