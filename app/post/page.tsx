"use client";
import { AppShell } from "@/components/AppShell";
import { PostTaskForm } from "@/components/PostTaskForm";
import { Eyebrow } from "@/components/ui/primitives";

export default function PostPage() {
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Post a task</Eyebrow>
          <span style={{ fontSize: 20, fontWeight: 600 }}>Buy a bonded task — pay from your wallet</span>
        </div>
        <PostTaskForm />
      </div>
    </AppShell>
  );
}
