import { AppShell } from "@/components/AppShell";
import { HireChat } from "@/components/hire/HireChat";

export const metadata = { title: "Hire ENGYE" };

export default function HirePage() {
  return (
    <AppShell>
      <HireChat />
    </AppShell>
  );
}
