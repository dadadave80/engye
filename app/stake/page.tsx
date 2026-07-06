import { AppShell } from "@/components/AppShell";
import { StakePanel } from "@/components/StakePanel";

export const metadata = { title: "Stake behind ENGYE" };

export default function StakePage() {
  return (
    <AppShell>
      <div className="page-head">
        <p className="kicker">Co-insurance</p>
        <h1>Stake behind the broker.</h1>
        <p className="lede">Back the broker&apos;s judgment with your own USDC — earn from every clean settle, pay your share of every slash.</p>
        <hr className="ledger-rule" />
      </div>
      <StakePanel />
    </AppShell>
  );
}
