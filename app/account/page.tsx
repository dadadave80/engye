"use client";
import { AppShell } from "@/components/AppShell";
import { AccountPanel } from "@/components/AccountPanel";
import { Eyebrow } from "@/components/ui/primitives";

export default function AccountPage() {
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Profile</Eyebrow>
          <span style={{ fontSize: 20, fontWeight: 600 }}>Your account</span>
        </div>
        <AccountPanel />
      </div>
    </AppShell>
  );
}
