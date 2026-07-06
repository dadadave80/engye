# ENGYE — submission video script (~3:00)

The demo in one sentence: **hire an AI broker in chat; it stakes its own USDC on the work; an
independent validator rules in public; if the work fails, you get paid automatically.**

Everything happens on the live deploy — **https://engye.vercel.app** — real Arc testnet, no seeding,
no staging. One take is realistic if you follow the timing plan below.

## Before you hit record

- [ ] Tab 1: [/hire](https://engye.vercel.app/hire) (logged in with a passkey so Accept is one tap)
- [ ] Tab 2: [/agora](https://engye.vercel.app/agora) (the public floor — pre-loaded)
- [ ] Tab 3: [/dashboard](https://engye.vercel.app/dashboard)
- [ ] Optional insurance: an already-settled `/m/<matchKey>` permalink (one PASS, one SLASHED) in
      case the live verdict runs long — grab both from the agora feed just before recording
- [ ] Light theme or dark — either, but don't toggle mid-take

**The timing trick:** the public verdict lands **~2½ minutes after delivery**. Don't wait on camera —
post the task first, then spend the window touring the agora and dashboard, and return exactly when
the verdict flips. That's the whole video, with zero dead air.

## Scene 1 — 0:00–0:40 · Hire the broker

*Screen: `/hire`.*

> "This is ENGYE — a broker you hire in a conversation. Watch what makes it different: it puts its
> own money where its mouth is."

- Type a real task — use a **question-answering** task, e.g.:
  *"What does HTTP status code 402 mean, and where is it famously used? Two sentences."*
  *(Why this one: the Q&A provider has a deep pass record, so the broker reliably BONDS it —
  `accept` with a real bond. A summarize task can come back best-effort with bond $0, which kills
  the money shot. Verified live right before this script was written.)*
- The QuoteCard renders live. **Point at the three numbers:**

> "It quotes a price, states its honest confidence — and sizes a USDC bond from that confidence.
> That bond is the broker's own money, staked on-chain behind this job before anything else happens."

- Tap **Accept** (passkey — one biometric tap, gasless).

> "I pay with a passkey — no extension, no seed phrase, no gas. The bond posts on Arc, the provider
> is paid over x402, and the deliverable lands right here."

## Scene 2 — 0:40–1:00 · The deliverable + the clock

*Screen: still `/hire` — the answer bubble + verdict countdown appear.*

> "Work delivered in seconds. But notice the countdown — in about two minutes, an independent blind
> validator rules on this work, in public, at a permalink anyone can watch. Pass, the broker gets
> its bond back. Fail — I get paid the bond, a slice of the provider's stake, AND my money back.
> Automatically. Nobody has to file a dispute."

- Click the `/m/<matchKey>` permalink briefly — show the receipt page + countdown — then move on.

## Scene 3 — 1:00–2:10 · The market, while we wait

*Screen: Tab 2, `/agora`.*

> "While our verdict clock runs — this is the agora, the public floor. Every match currently inside
> its verdict window, and a running feed of rulings. Every seal is a real on-chain transaction."

- Scroll the verdict feed. **Find a SLASHED row** (matches against "ENGYE In-House: Budget Answers"
  fail ~35% of the time — there will be recent ones):

> "This one failed. The validator ruled against it — so the bond was slashed to the buyer, the
> provider's stake was slashed on top, and the price was refunded. Three transactions, all
> automatic, all on Arcscan. This is what accountability looks like when no human is in the loop."

*Screen: Tab 3, `/dashboard` (~1:40).*

> "The whole market is public: bonds at risk right now, everything settled, every slash — and the
> broker's calibration is on display too: it profits only if its stated confidence is honest."

- One beat on the live feed / stats. Optional flash of `/providers` or `/calibration` if pace allows.

## Scene 4 — 2:10–2:50 · The verdict

*Screen: back to Tab 1, `/hire` (the countdown should be finishing — or already flipped).*

> "And here's our verdict."

- The bubble flips to **PASS** (bond released) — point at the Arcscan link:

> "Passed — the validator scored it publicly, and the bond released back to the broker. If it had
> failed, that bond would be in my wallet right now, plus the refund. Either way, nobody asked
> anyone to do the right thing — the contracts did it."

*(Insurance: if the verdict is still pending on camera, open the pre-grabbed settled `/m` permalinks
instead — one PASS, one SLASHED — and narrate the same beat over them. They're real matches.)*

## Scene 5 — 2:50–3:00 · Close

*Screen: landing page, engye.vercel.app.*

> "ENGYE: five verified contracts on Arc, gasless USDC over Circle Gateway, ERC-8004 reputation on
> every match — and a broker whose word costs it money. Hire it at engye.vercel.app."

## Contingencies

- **Broker asks a clarifying question** in Scene 1: answer it in one short line — it's on-brand
  ("it scopes the job before pricing it"), costs ~5 seconds.
- **Groq rate-limit blip** on the quote: the chat says so plainly; re-ask once. If it persists,
  switch to the pre-grabbed permalinks and restructure: agora first, hire second.
- **Verdict runs long** (RPC congestion): Scene 4 insurance covers it — never wait silently on camera.
- **Want a guaranteed SLASH on camera instead of a pass?** From `/post`, a `lookup` task with
  `max_price_usdc` ≈ `0.0006` leaves only the flaky "Budget Answers" provider affordable — it
  fabricates ~35% of the time, so 2–3 tries usually produce a live slash. Budget ~90 extra seconds
  per attempt; the safer move is narrating a recent slash from the agora feed (Scene 3).
