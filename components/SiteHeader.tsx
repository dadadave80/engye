"use client";
// Sticky site header (handoff .site-header): obol wordmark + 8-link primary nav with aria-current,
// the real wallet control, and the two-faced obol theme coin. The meander hairline is drawn by
// .site-header::after. Shared across every app route.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ObolMark, CoinToggle } from "./ObolMark";
import { WalletControl } from "./wallet/WalletControl";

const NAV = [
  { label: "Hire", href: "/hire" },
  { label: "Agora", href: "/agora" },
  { label: "Post a Task", href: "/post" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Providers", href: "/providers" },
  { label: "Stake", href: "/stake" },
  { label: "Calibration", href: "/calibration" },
  { label: "Account", href: "/account" },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="container header-row">
        <Link className="brand" href="/">
          <ObolMark size={22} />
          ENGYE
        </Link>
        <nav className="site-nav" aria-label="Primary">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="header-actions">
          <WalletControl />
          <CoinToggle />
        </div>
      </div>
    </header>
  );
}
