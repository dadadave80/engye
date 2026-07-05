// Self-check: SSRF rejects, public fetch extracts, fence wraps.
import { fetchPageText, fenceUntrusted } from "../lib/ingest";

for (const bad of ["http://example.com", "https://localhost/x", "https://169.254.169.254/meta"]) {
  let threw = false;
  try { await fetchPageText(bad); } catch { threw = true; }
  if (!threw) throw new Error(`SSRF guard failed to reject ${bad}`);
}
const text = await fetchPageText("https://example.com/");
if (!text.includes("Example Domain")) throw new Error("extraction failed");
if (!fenceUntrusted("x").includes("untrusted data")) throw new Error("fence broken");
console.log("ingest self-check ✓");
