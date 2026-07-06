import { AppShell } from "@/components/AppShell";
import { AccountPanel } from "@/components/AccountPanel";

export const metadata = { title: "Account — ENGYE" };

export default function AccountPage() {
  return (
    <AppShell>
      <div className="page-head">
        <p className="kicker">Your Ledger</p>
        <h1>Account.</h1>
        <p className="lede">Balances, signers, and recovery — the keys behind your pledges.</p>
        <hr className="ledger-rule" />
      </div>
      <AccountPanel />
    </AppShell>
  );
}
