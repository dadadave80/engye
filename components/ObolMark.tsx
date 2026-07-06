// The constructed owl-coin (obol) as inline currentColor linework — the only in-page mark.
// `simple` drops the dashed ring + brows for tiny sizes (chat head, 16px).
export function ObolMark({ size = 24, simple = false, className }: { size?: number; simple?: boolean; className?: string }) {
  if (simple) {
    return (
      <svg className={className ?? "obol-mark"} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="25.5" cy="30" r="5" fill="none" stroke="currentColor" strokeWidth="2.6" />
        <circle cx="38.5" cy="30" r="5" fill="none" stroke="currentColor" strokeWidth="2.6" />
        <path d="M 29.5 37 L 34.5 37 L 32 42 Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className={className ?? "obol-mark"} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.5 3.5" />
      <path d="M 19 27 Q 25.5 22 32 27 M 32 27 Q 38.5 22 45 27" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="25.5" cy="31" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="38.5" cy="31" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="25.5" cy="31" r="1.8" fill="currentColor" />
      <circle cx="38.5" cy="31" r="1.8" fill="currentColor" />
      <path d="M 29.5 37 L 34.5 37 L 32 42 Z" fill="currentColor" />
    </svg>
  );
}

// The two-faced obol theme switch. Pure markup: engye-theme.js (inlined in the root layout)
// wires the click via event delegation and syncs aria-checked/aria-label. Static markup so it
// works in a server component; the coin's rotateY flip is CSS driven by [data-theme].
export function CoinToggle() {
  return (
    <button className="coin-toggle" type="button" role="switch" aria-checked="false" aria-label="Switch theme">
      <span className="coin">
        <span className="face reverse" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M 20 12.5 A 8.5 8.5 0 1 1 11.5 4 A 6.8 6.8 0 0 0 20 12.5 Z" />
          </svg>
        </span>
        <span className="face obverse" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        </span>
      </span>
    </button>
  );
}
