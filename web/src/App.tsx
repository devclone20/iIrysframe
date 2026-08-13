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

function Shell() {
  const [tab, setTab] = useState<Tab>("create");
  const w = useWallet();

  return (
    <>
      <TopBar tab={tab} onTab={setTab} />

      {!w.available && (
        <div className="setup-banner">
          <span>Wallet login is off.</span> Set <code>VITE_PRIVY_APP_ID</code> in <code>web/.env</code> (free at
          dashboard.privy.io) and restart <code>npm run dev</code>. Create still works for building and processing.
        </div>
      )}

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
