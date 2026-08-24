# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo TikTok LIVE streamers (Spanish-speaking, likely LatAm) who buy a license and run the control panel themselves during their own broadcast — on the streaming machine or a second device — while an OBS browser-source overlay shows the live game to viewers. No agencies or multi-account operators today; one license maps to one streamer.

## Product Purpose

Gives a solo TikTok LIVE streamer an all-in-one control panel that turns viewers' TikTok gifts into real-time interactive mini-games, mirrored live on an OBS overlay for the audience to watch. Success is a streamer running an engaging, glitch-free interactive segment mid-broadcast without needing multiple separate tools.

## Positioning

One license bundles four distinct gift-driven game modes — King of the Throne, Zubastinis, Elimination, Color Says — under a single control panel and overlay, instead of a streamer stitching together separate single-purpose gift-game tools. The pitch is breadth of the bundled game suite, not raw connection reliability (though reliability is still a hard requirement, see Product Principles).

## Operating Context

- The streamer opens the control panel in a browser (same machine as the stream, or a second device/monitor) and logs in with a license key.
- A second browser source is added to OBS pointed at the overlay URL (`?overlay=true&key=...`); it mirrors live game state for the stream audience and has no controls of its own.
- Real TikTok LIVE gift/like events stream in via `tiktok-live-connector` and drive game state server-side, broadcast to both panel and overlay over Socket.io.
- Color Says is the one mode with no TikTok connection dependency — it's played straight from its own screen/segment.

## Capabilities and Constraints

- **Four game modes**, each with its own timer/state machine on the backend:
  - **King of the Throne (Rey del Trono):** race to be the last/target gifter before time runs out, with an insta-win gift and a "snipe" extension window.
  - **Zubastinis:** top-3 gifters by total coins within a fixed window, optional minimum coin threshold, tiebreak round on a tie for first.
  - **Elimination (Eliminación):** viewers join by sending a specific gift; rounds randomly eliminate one joined participant at a time (with a reveal/roulette animation) until a winner remains; supports a rejoin window.
  - **Color Says:** standalone color-guess dice mini-game; admin-only has a configurable "pair bias" toggle, all paying licenses always get a fair roll.
- **Multi-tenant backend:** one `Tenant` instance per active license, each with its own isolated Socket.io room — licenses never see each other's state or TikTok connection.
- **Licensing is manual and single-owner:** the admin (today, one person: `notbenjaa1`) hand-issues license keys from the License Manager panel; there is no self-serve signup or payment flow. License durations: day / week / month / lifetime.
- **One active device per license by default:** logging in elsewhere kicks the prior session out with a visible notice; a license can be explicitly flagged "multi-device" (todopoderosa) to lift this, intended for the owner, not paying customers.
- **Theming:** the control panel supports switchable UI themes via a dedicated theme picker.
- **Live-connection resilience:** the backend retries the TikTok LIVE connection every ~3s while a username is set, independent of the operator pressing Start, so a dropped connection recovers without manual intervention.

## Brand Commitments

- Name: **TikTok Concurso**.
- All UI copy is in **Spanish**, written for a Spanish-speaking (likely LatAm) creator audience — future surfaces default to Spanish, not English.
- Voice is playful and gamer-leaning: emoji-forward mode labels (👑 🏆 💀 🎲) and energetic, all-caps action copy ("ENTRAR", "CREAR LICENCIA").

## Evidence on Hand

None. No testimonials, case studies, pricing page, press, or other proof assets exist in the repo. Future work must not fabricate any of these.

## Product Principles

1. **One license, four games.** The bundled suite's breadth is the pitch — new work should extend or polish the shared panel/overlay, not fragment into single-game side tools.
2. **Live-connection resilience over game polish.** The backend auto-retries the TikTok LIVE connection continuously; every game must degrade gracefully on a flaky connection rather than strand the streamer mid-broadcast.
3. **Panel and overlay are one shared truth.** The operator-facing control panel and the OBS-facing overlay are separate surfaces that must never visually disagree about current game state.
4. **Manual trust, not self-serve.** Licensing is hand-issued by one admin to a small, personally vetted set of streamers — don't design flows that assume anonymous signup, checkout, or account self-management.
5. **Spanish-first, LatAm creator voice.** Copy, tone, and any new surface default to Spanish and to the energetic, emoji-forward register already established.
