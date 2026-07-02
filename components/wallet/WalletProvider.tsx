"use client";
// Wallet layer: wagmi (EOA connectors) + react-query, plus our passkey/Ithaca account
// context layered on top via useWallet(). Arc testnet is built into viem/chains.
import { createConfig, http, WagmiProvider } from "wagmi";
import { arcTestnet } from "viem/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { PasskeyProvider } from "./passkey";

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: { [arcTestnet.id]: http(process.env.NEXT_PUBLIC_RPC_URL || undefined) },
  ssr: true,
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <PasskeyProvider>{children}</PasskeyProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
