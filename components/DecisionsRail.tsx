// Broker decisions — handoff .decision <details> rows (native toggle, +/− via CSS). Server
// component; the first row is open by default. Shows an EV-gate decline when the broker has one.
import type { DecisionItem } from "@/lib/queries";

export function DecisionsRail({ decisions }: { decisions: DecisionItem[] }) {
  if (decisions.length === 0) {
    return <div className="table-wrap"><div className="small muted" style={{ padding: "var(--space-4) var(--space-6)" }}>No decisions yet.</div></div>;
  }
  return (
    <div className="table-wrap">
      {decisions.map((d, i) => (
        <details key={d.id} className="decision" open={i === 0}>
          <summary>
            <span>{d.headline}</span>
            <span className="meta">{d.chips.join(" · ")}</span>
          </summary>
          <div className="body">{d.body}</div>
        </details>
      ))}
    </div>
  );
}
