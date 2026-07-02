"use client";
import { AppShell } from "@/components/AppShell";
import { StakePanel } from "@/components/StakePanel";
import { Eyebrow } from "@/components/ui/primitives";

export default function StakePage() {
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Provider co-insurance</Eyebrow>
          <span style={{ fontSize: 20, fontWeight: 600 }}>Stake behind your endpoint</span>
        </div>
        <StakePanel />
      </div>
    </AppShell>
  );
}
