import type { Metadata, Viewport } from "next";
import "./globals.css";
import { WalletProvider } from "@/components/wallet/WalletProvider";

export const metadata: Metadata = {
  title: "ENGYE — The Bonded Broker",
  description:
    "An AI broker that stakes USDC on its own judgment. Every match bonded on Arc. Every failure compensated.",
};

// Responsive across ultrawide → iPhone SE. Zoom stays enabled (accessibility) — no maximum-scale.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2EDE0" },
    { media: "(prefers-color-scheme: dark)", color: "#191511" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
