# Private conversation operations

## Prototype Render deployment

The dedicated prototype is hosted at <https://dlang-stewards.onrender.com/>.
Render service `srv-dbr277c9v7es73egk230` uses one Ohio instance on the
$7/month 0.5 CPU / 512 MB plan, deploying `main` from this repository.
Build: `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`.
Start: `HOST=0.0.0.0 node server.js`; Render supplies `PORT`.

The first-month prototype allocation began November 12, 2026. **Review and
explicitly downgrade or suspend by December 12, 2026** if continuing is not
approved. Render renews automatically; no automatic cancellation is installed.
Do not delete the service or its secrets as a substitute for a reviewed shutdown.

Server-only LiveKit credentials are managed in Render environment variables.
The voice allowlist retains the existing five-wallet DLang pilot roster plus
the explicitly approved `decentagency.eth` address
(`0xcAeEd8422fB5682C298B7F0971906d446fFd4e7a`),
with one room, two concurrent sessions and twenty rooms/day. Paid rounds remain
closed. Local `.env.services` and the derived `.env.render` are private,
git-ignored files, not deployable public assets; never import a local loopback
`HOST` override into Render.

Dated November 12 acceptance: public landing and `/health` return 200,
`privateConversationConfigured` is true, the same-origin conversation config
returns 200, and a read-only provider request accepted the LiveKit credentials.
No room was created for that check. These observations are not continuous
monitoring or two-device media acceptance.

November 12 live transport acceptance, after deploying `7b601d9`: two
isolated Chromium contexts (1280px desktop and 375px mobile viewport) used
real message signatures for `thejollylama.eth`
(`0x807061DF657A7697c04045dA7d16D941861cAABc`) and `decentagency.eth`.
Private keys stayed in the local signer process; no blockchain transaction
was requested. Generated 440Hz/660Hz Web Audio tracks replaced microphone
capture; they traversed the deployed HTTPS invitation/session/control API
and real LiveKit WebRTC transport, not a fake media server.

Both receivers reported advancing audio playback, received RTP packets
(45/52 in the sampled interval) and positive decoded audio energy.
Mute disabled the sending track, host-initiated teardown stopped both clients'
capture and remote playback, and a second one-minute room verified listen-only mode
(zero outbound audio packets for the listener) and automatic expiry.
Provider inspection found zero remaining DLang rooms after cleanup.
The first room tested host-initiated leave; it did not separately test
guest-initiated leave. Initial Chromium fake-device capture failed with
`NotSupportedError`; explicit generated tracks were used for the successful
transport tests. This is not physical-device, actual microphone permission,
audible speaker quality, pronunciation or provider-retention acceptance.

Private invited audio is disabled unless an operator supplies all of the backend
settings below. The operator wallet list is an admission allowlist, not proof
that a participant has consented. Wallet signatures authorize one short-lived
invitation/session; no private key is stored by this service.

| Variable | Required value |
| --- | --- |
| `DLANG_CONVERSATION_ORIGINS` | Comma-separated exact HTTPS page origins (HTTP `localhost`/loopback only for local testing). |
| `DLANG_CONVERSATION_WALLETS` | At least two distinct invited `0x` wallet addresses. |
| `DLANG_LIVEKIT_URL` | Exact LiveKit `wss://` origin, without path, credentials or query. |
| `DLANG_LIVEKIT_API_KEY` | Server-side LiveKit API key. |
| `DLANG_LIVEKIT_API_SECRET` | Server-side LiveKit API secret; never expose it to browser code or logs. |
| `DLANG_CONVERSATION_MAX_ROOMS` | Optional integer 1–100; default 1. |
| `DLANG_CONVERSATION_MAX_SESSIONS` | Optional integer 2–100; default 2. |
| `DLANG_CONVERSATION_MAX_ROOMS_PER_DAY` | Optional integer 1–100; default 20. |
| `HOST`, `PORT` | Optional bind address and port; defaults to `127.0.0.1:8888`. Put production traffic behind the operator's HTTPS reverse proxy. |

Install the pinned dependencies, run `npm run build:conversation-client`, set secrets through the deployment secret
manager, and start with `npm start`. Missing or invalid settings leave voice
disabled and produce a generic startup warning; `/health` reports
`privateConversationConfigured: false`. Complete settings set it to `true`;
this confirms configuration only, not LiveKit reachability or working media.
The HTTP API still checks exact browser origins and wallet signatures, and
issues short-lived, two-participant, audio-only room grants. Its per-instance
room/session/day limits are hard caps, not billing controls.

Use a dedicated LiveKit project and exactly one DLang conversation server
instance: startup cleanup removes old rooms named `conversation:<id>`. A
multi-instance deployment or shared LiveKit project is not supported. The
operator must separately set provider usage/billing alerts, project limits,
network controls, secret rotation, TLS, backups and incident response. Room
cleanup retries provider deletion, but it does not delete provider logs,
diagnostics or backups.

Serve the static app and conversation API at the same HTTPS origin. The app
fetches `/api/dlang/conversation/config` from that origin; the response carries
only the relative API path and LiveKit WSS origin, never backend credentials.
GitHub Pages alone cannot enable voice and must continue to show it as
unavailable. The HTML loads the pinned, self-hosted browser SDK. The server
being configured does not prove LiveKit is reachable or that real audio works.

The service sends live audio to the configured LiveKit project. This app does
not record audio or persist transcripts; that does not establish zero
provider/telemetry retention. Get explicit informed consent before microphone
capture, keep listen-only available, and explain provider retention in the
participant-facing notice. Disable this service if retention, language
coverage, safeguarding or cost limits are not acceptable.

Voice is optional practice only. It is not connected to scored attempts,
pronunciation grading, eligibility, rewards or payment. Do not use a transcript
match or model confidence as a score or financial oracle.

## Walking two learners through their first call

The white-rabbit tour's Voices hop opens the Voices panel and points to
**How to practice together: two-device audio** beside Scene conversation.
This expandable guide remains readable even when audio is unavailable.
It links to the hosted app and explains the approved, distinct wallet
requirement, host invitation, private room-ID sharing, guest signature,
consent, listen-only mode, microphone permission and troubleshooting.
It does not connect a wallet, start a room or capture audio by opening.

For the first supervised test, confirm that both addresses are on the operator
allowlist; do not request private keys. Use two physical devices with
wallet-enabled browsers and headphones. Follow the in-app guide with a
one-minute room. Check sound in both directions, mute, leave and expiry;
use fresh rooms for permission-denial and listen-only checks. Either
participant leaving ends the room for both. Muting is one-way in this client;
speaking again requires a fresh room. Do not rapidly retry failed room creation:
the pilot has one concurrent room and twenty creations per day.

Record actual acceptance results separately from automated test results.
The published instructions are not proof that real two-device audio works.

## Automated checks and remaining release gates

The automated conversation suite uses local HTTP, real wallet signatures and a
fake LiveKit transport; it spends no provider credits and is not evidence of
real media. Before enabling production, separately accept: browser SDK loading,
two-device audio, microphone denial, listen-only mode, mute/leave, expiry,
wallet change, navigation cleanup, keyboard/mobile accessibility, provider
language/dialect suitability, retention disclosure, quota behavior and
operator billing limits. No AI speech recognition, transcript storage or
pronunciation scoring is configured by these settings.
