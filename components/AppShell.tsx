import { type ReactNode } from "react";
import { AppHeader } from "./AppHeader";

export function AppShell({ settled, children }: { settled?: number; children: ReactNode }) {
  return (
    <div className="dark" style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", fontFamily: "var(--font-body)", colorScheme: "dark" }}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <AppHeader settled={settled} />
      <div className="meander-hairline" />
      <main id="main-content" tabIndex={-1} className="container" style={{ paddingBlock: 24, outline: "none" }}>{children}</main>
    </div>
  );
}
