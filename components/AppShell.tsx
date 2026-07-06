import { type ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

// App chrome: sticky header (with the meander hairline) → container'd main → footer. Bypass for
// assistive tech is provided by the <header>/<nav>/<main>/<footer> landmarks (no skip-link — it
// flashed on client navigation).
// Theme-driven via [data-theme] on <html> (set pre-paint in the root layout); no forced .dark.
// `settled` is accepted for call-site compatibility but the handoff header carries no live pill.
// `fill` = a fixed-viewport route (e.g. /hire): main fills the screen so its own content (a chat
// composer) stays pinned in view at any height; the footer is dropped since the page never scrolls.
export function AppShell({ fill, children }: { settled?: number; fill?: boolean; children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className={fill ? "app-main-fill" : undefined}>
        <div className="container">{children}</div>
      </main>
      {!fill && <SiteFooter />}
    </>
  );
}
