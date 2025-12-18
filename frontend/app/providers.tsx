"use client";

import React from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true, // optional
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId="cmj67rsn0020jl70c363w4x58"
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#14F195",
          logo: "https://cryptologos.cc/logos/solana-sol-logo.png",

          // Solana only
          walletChainType: "solana-only",

          // Show Phantom only (you can add 'solflare' etc later)
          walletList: ["phantom"],
        },

        // ✅ THIS is what makes Phantom appear
        externalWallets: {
          solana: {
            connectors: solanaConnectors,
          },
        },

        embeddedWallets: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
