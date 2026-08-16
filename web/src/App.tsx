import { useState } from "react";
import { TopBar } from "./components/TopBar";
import { Create } from "./components/Create";
import { Launch } from "./components/Launch";
import { Vault } from "./components/Vault";
import { Agent } from "./components/Agent";
import { Playground } from "./components/Playground";
import { Swap } from "./components/Swap";
import { SoulUpdate } from "./components/SoulUpdate";
import { Toaster, ConfirmHost } from "./ui";
import { CollectionProvider } from "./collection";
import { SoulProvider } from "./soulStore";
import { useWallet } from "./wallet";
import { SettingsButton } from "./components/Settings";
import { AssistantDock } from "./components/Assistant";
import { IrysBase } from "./components/IrysBase";

export type Tab = "create" | "launch" | "vault" | "irysbase" | "agent" | "swap" | "soulupdate" | "playground";

export default function App() {
  return (
    <SoulProvider>
      <CollectionProvider>
        <Shell />
      </CollectionProvider>
    </SoulProvider>
  );
}

/** No wallet login yet: take the Privy App ID right here. Saving it in the
 *  browser means the prebuilt download works for anyone — no rebuild, no .env. */
function SetupBanner() {
  const [id, setId] = useState("");
  return (
    <div className="setup-banner">
      <span>Wallet login is off.</span> Paste a Privy App ID (free at{" "}
      <a href="https://dashboard.privy.io" target="_blank" rel="noopener noreferrer">dashboard.privy.io</a>) to
      enable sealing — or set <code>VITE_PRIVY_APP_ID</code> in <code>web/.env</code>. Create still works for
      building and processing.
      <span className="setup-banner__form">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Privy App ID"
          spellCheck={false}
          aria-label="Privy App ID"
        />
        <button
          className="btn btn--mini btn--primary"
          disabled={id.trim().length < 8}
          onClick={() => {
            try {
              localStorage.setItem("iirys.privyAppId", id.trim());
            } catch {
              /* private mode */
            }
            location.reload();
          }}
        >
          Save &amp; reload
        </button>
      </span>
    </div>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>("create");
  const w = useWallet();

  return (
    <>
      <TopBar tab={tab} onTab={setTab} />

      {!w.available && <SetupBanner />}

      <main>
        <div hidden={tab !== "create"}>
          <Create goLaunch={() => setTab("launch")} />
        </div>
        <div hidden={tab !== "launch"}>
          <Launch goCreate={() => setTab("create")} />
        </div>
        <div hidden={tab !== "vault"}>
          <Vault />
        </div>
        <div hidden={tab !== "agent"}>
          <Agent />
        </div>
        <div hidden={tab !== "swap"}>
          <Swap />
        </div>
        <div hidden={tab !== "irysbase"}>
          <IrysBase />
        </div>
        <div hidden={tab !== "soulupdate"}>
          <SoulUpdate />
        </div>
        <div hidden={tab !== "playground"}>
          <Playground />
        </div>
      </main>

      <SettingsButton />
      <AssistantDock />
      <Toaster />
      <ConfirmHost />
    </>
  );
}
