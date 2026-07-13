import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { base } from "viem/chains";
import App from "./App";
import { PrivyWalletProvider, StubWalletProvider } from "./wallet";
import { StoreProvider } from "./store";
import { applyTheme } from "./profile";
import "./styles.css";

applyTheme();

const appId = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim();

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    {appId ? (
      <PrivyProvider
        appId={appId}
        config={{
          appearance: {
            theme: "dark",
            accentColor: "#D4D9E1",
            walletChainType: "ethereum-only",
            showWalletLoginFirst: true,
          },
          defaultChain: base,
          supportedChains: [base],
          embeddedWallets: { createOnLogin: "users-without-wallets" },
          loginMethods: ["wallet", "email", "google", "farcaster"],
        }}
      >
        <PrivyWalletProvider>
          <StoreProvider>
            <App />
          </StoreProvider>
        </PrivyWalletProvider>
      </PrivyProvider>
    ) : (
      <StubWalletProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </StubWalletProvider>
    )}
  </React.StrictMode>,
);
