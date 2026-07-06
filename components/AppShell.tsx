import { type ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

// App chrome: sticky header (with the meander hairline) → container'd main → footer. Bypass for
// assistive tech is provided by the <header>/<nav>/<main>/<footer> landmarks (no skip-link — it
// flashed on client navigation).
// Theme-driven via [data-theme] on <html> (set pre-paint in the root layout); no forced .dark.
// `settled` is accepted for call-site compatibility but the handoff header carries no live pill.
export function AppShell({ children }: { settled?: number; children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <div className="container">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
