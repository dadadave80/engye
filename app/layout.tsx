import type { Metadata, Viewport } from "next";
import "./globals.css";
import { WalletProvider } from "@/components/wallet/WalletProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://engye.vercel.app"),
  title: "ENGYE — the first AI that stakes its own money on its work",
  description:
    "ENGYE quotes your task, posts a USDC bond on Arc, and lets a public validator rule. Pass — the bond comes home. Fail — it's slashed and paid to you.",
  openGraph: {
    type: "website",
    siteName: "ENGYE",
    url: "https://engye.vercel.app",
    title: "ENGYE — the AI that stakes its own money",
    description: "Every task bonded on Arc. Every failure compensated.",
  },
  twitter: {
    card: "summary_large_image",
    title: "ENGYE — the AI that stakes its own money",
    description: "Every task bonded on Arc. Every failure compensated.",
  },
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
