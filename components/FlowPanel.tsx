// Money flow — the requester → broker → provider → broker path of one settled bonded match,
// rendered as the handoff .flow strip. Figures come from the last settled bonded match in the feed.
const fx = (n: number) => n.toFixed(3);

export function FlowPanel({ last }: { last?: { price: number; bond: number } }) {
  if (!last) {
    return <div className="card small muted">No settled bonded match yet — the flow appears once a bond has been posted and released.</div>;
  }
  const steps = [
    { route: ["you", "escrow"], figure: fx(last.price), note: "price, via x402" },
    { route: ["broker", "bond"], figure: fx(last.bond), note: "its own stake" },
    { route: ["escrow", "provider"], figure: fx(last.price), note: "paid on delivery" },
    { route: ["bond", "broker"], figure: fx(last.bond), note: "released on PASS" },
  ];
  return (
    <div className="flow">
      {steps.map((s, i) => (
        <div key={i} className="step">
          <div className="route">{s.route[0]} <span className="arrow">→</span> {s.route[1]}</div>
          <div className="figure">{s.figure}</div>
          <div className="small muted">{s.note}</div>
        </div>
      ))}
    </div>
  );
}
