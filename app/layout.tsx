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

// Single theme-color meta so the coin toggle can rewrite it (the pre-paint script sets the
// correct value on load). Zoom stays enabled (accessibility) — no maximum-scale.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1B1815",
};

// engye-theme.js (handoff), inlined verbatim so the theme resolves BEFORE first paint (no flash)
// and the coin toggle is wired via event delegation. data-theme lands on <html>; first open
// follows prefers-color-scheme and keeps following the OS until the visitor flips the coin.
const THEME_SCRIPT = `(function () {
  "use strict";
  var KEY = "engye-theme.v2";
  var THEME_COLOR = { dark: "#1B1815", light: "#EAE7E0" };
  var memory = null;
  var store = {
    get: function () { try { return window.localStorage.getItem(KEY) || memory; } catch (e) { return memory; } },
    set: function (v) { memory = v; try { window.localStorage.setItem(KEY, v); } catch (e) {} }
  };
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  function systemTheme() { return media && media.matches ? "light" : "dark"; }
  var stored = store.get();
  var theme = stored === "light" || stored === "dark" ? stored : systemTheme();
  apply(theme);
  function apply(t) {
    document.documentElement.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLOR[t]);
    syncToggles(t);
  }
  function syncToggles(t) {
    var toggles = document.querySelectorAll(".coin-toggle");
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].setAttribute("aria-checked", t === "light" ? "true" : "false");
      toggles[i].setAttribute("aria-label", t === "light" ? "Switch to dark theme" : "Switch to light theme");
    }
  }
  function ready() {
    syncToggles(document.documentElement.getAttribute("data-theme") || "dark");
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".coin-toggle");
      if (!btn) return;
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      store.set(next);
      apply(next);
    });
    if (media && media.addEventListener) {
      media.addEventListener("change", function () { if (!store.get()) apply(systemTheme()); });
    }
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { document.documentElement.classList.add("theme-anim"); });
    });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", ready); } else { ready(); }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
