import { AppShell } from "@/components/AppShell";
import { PostTaskForm } from "@/components/PostTaskForm";

export const metadata = { title: "Post a task — ENGYE" };

export default function PostPage() {
  return (
    <AppShell>
      <div className="page-head">
        <p className="kicker">Bring Work</p>
        <h1>Post a task.</h1>
        <p className="lede">Put a task on the floor — the broker quotes it, bonds it, and answers for it.</p>
        <hr className="ledger-rule" />
      </div>
      <PostTaskForm />
    </AppShell>
  );
}
