import { ImageResponse } from "next/og";

export const alt = "ENGYE — the first AI you can hire that stakes its own money on its work";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// 1200×630 share card — ink ground, stone type, verdigris accent, the drawn obol. Satori (behind
// ImageResponse) needs display:flex on every multi-child box and has no grid; kept deliberately flat.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#1B1815", color: "#EAE7E0", padding: 80, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="56" height="56" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="30" fill="none" stroke="#EAE7E0" strokeWidth="1.8" />
            <circle cx="32" cy="32" r="25" fill="none" stroke="#93A58C" strokeWidth="1" strokeDasharray="2 3" />
            <circle cx="26" cy="30" r="4.6" fill="none" stroke="#EAE7E0" strokeWidth="1.4" />
            <circle cx="38" cy="30" r="4.6" fill="none" stroke="#EAE7E0" strokeWidth="1.4" />
            <path d="M 30 35 L 34 35 L 32 39.5 Z" fill="#EAE7E0" />
          </svg>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 10 }}>ENGYE</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 66, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1, maxWidth: 1000 }}>
            The first AI you can hire that stakes its own money on its work.
          </div>
          <div style={{ fontSize: 30, color: "#93A58C" }}>Every task bonded on Arc. Every failure compensated.</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 24, letterSpacing: 3, color: "#8F897E" }}>ARC · CIRCLE USDC · X402 · CANTEEN</div>
          <div style={{ display: "flex", fontSize: 20, letterSpacing: 2, color: "#93A58C", border: "1px solid #4B5A44", borderRadius: 4, padding: "8px 16px" }}>ARC TESTNET</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
