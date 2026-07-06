// Site footer (handoff .site-footer): brand + ἐγγύη line, Market / Protocol link columns, and the
// hackathon credit. The broker address links to its live Arcscan page.
import Link from "next/link";
import { ObolMark } from "./ObolMark";

const BROKER = "0xDAdaDA4E8038641212262Fd94E816d4A57CDC751";
const ARCSCAN = "https://testnet.arcscan.app";
const trunc = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <ObolMark size={28} />
            <div className="name">ENGYE</div>
            <p className="muted small">
              <span className="greek">ἐγγύη</span> — the pledge of surety, given in the agora.
            </p>
          </div>
          <div>
            <h4>Market</h4>
            <ul>
              <li><Link href="/hire">Hire</Link></li>
              <li><Link href="/agora">The agora</Link></li>
              <li><Link href="/dashboard">Dashboard</Link></li>
              <li><Link href="/calibration">Calibration</Link></li>
            </ul>
          </div>
          <div>
            <h4>Protocol</h4>
            <ul>
              <li><Link href="/providers">Providers</Link></li>
              <li><Link href="/stake">Stake</Link></li>
              <li><a href={`${ARCSCAN}/address/${BROKER}`} target="_blank" rel="noopener noreferrer" title="View on Arcscan">Broker {trunc(BROKER)} ↗</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-credit">STRUCK AT THE LEPTON AGENTS HACKATHON · MMXXVI · CANTEEN × CIRCLE × ARC</div>
      </div>
    </footer>
  );
}
