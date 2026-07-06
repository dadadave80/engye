import { AppShell } from "@/components/AppShell";
import { HireChat } from "@/components/hire/HireChat";

export const metadata = { title: "Hire ENGYE — the bonded broker" };

export default function HirePage() {
  return (
    <AppShell>
      <div className="page-head">
        <p className="kicker">The Concierge</p>
        <h1>Hire the broker.</h1>
        <p className="lede">Tell it the job. It quotes a price, stakes its own USDC behind the work, and its validator rules in public — pass, or you&apos;re paid.</p>
        <hr className="ledger-rule" />
      </div>
      <HireChat />
    </AppShell>
  );
}
