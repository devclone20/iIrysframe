import { useState } from "react";
import { TopBar } from "./components/TopBar";
import { Soul } from "./components/Soul";
import { Engine } from "./components/Engine";
import { Irys } from "./components/Irys";
import { Vault } from "./components/Vault";
import { Swap } from "./components/Swap";
import { MintingContracts } from "./components/MintingContracts";
import { Toaster, ConfirmHost } from "./ui";
import { CollectionProvider } from "./collection";
import { SoulProvider } from "./soulStore";
import { useWallet } from "./wallet";

export type Tab = "soul" | "engine" | "iirys" | "vault" | "swap" | "contracts";

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
  const [tab, setTab] = useState<Tab>("soul");
  const w = useWallet();

  return (
    <>
      <TopBar tab={tab} onTab={setTab} />

      {!w.available && (
        <div className="setup-banner">
          <span>⚠ Wallet login is off.</span> Set <code>VITE_PRIVY_APP_ID</code> in <code>web/.env</code> (free at
          dashboard.privy.io) and restart <code>npm run dev</code>. The Engine still works for generating.
        </div>
      )}

      <main>
        <div hidden={tab !== "soul"}>
          <Soul goEngine={() => setTab("engine")} />
        </div>
        <div hidden={tab !== "engine"}>
          <Engine goIrys={() => setTab("iirys")} />
        </div>
        <div hidden={tab !== "iirys"}>
          <Irys goVault={() => setTab("vault")} goEngine={() => setTab("engine")} />
        </div>
        <div hidden={tab !== "vault"}>
          <Vault />
        </div>
        <div hidden={tab !== "swap"}>
          <Swap />
        </div>
        <div hidden={tab !== "contracts"}>
          <MintingContracts />
        </div>
      </main>

      <Toaster />
      <ConfirmHost />
    </>
  );
}
