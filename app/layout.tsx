import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ENGYE — The Bonded Broker",
  description:
    "An AI broker that stakes USDC on its own judgment. Every match bonded on Arc. Every failure compensated.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
