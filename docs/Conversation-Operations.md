# Private conversation operations

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

## Local checks and release gates

The automated conversation suite uses local HTTP, real wallet signatures and a
fake LiveKit transport; it spends no provider credits and is not evidence of
real media. Before enabling production, separately accept: browser SDK loading,
two-device audio, microphone denial, listen-only mode, mute/leave, expiry,
wallet change, navigation cleanup, keyboard/mobile accessibility, provider
language/dialect suitability, retention disclosure, quota behavior and
operator billing limits. No AI speech recognition, transcript storage or
pronunciation scoring is configured by these settings.
