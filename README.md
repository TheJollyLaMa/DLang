# DLang

Notice, name, narrate. An independent visual language-learning application:
original seek-and-find scenes, varied visual concepts and simultaneous
multilingual study. DLang is not affiliated with any commercial lesson platform.

## Current availability

- English, Spanish, French, Hindi (Devanagari) and Mandarin Simplified with pinyin.
  All vocabulary/aliases are seed content, **not fluent-speaker reviewed**.
  Pinyin is a study aid; scored Mandarin answers use Chinese characters.
- **Free practice:** three flexible two-minute sessions per local day, 72 seed
  concepts and 1,095 reproducible original SVG compositions. Each recipe day has
  three different 12-object sets; due concepts prioritize order within that set.
  Layout/order/colors and 32 object design combinations vary. No identical object
  exemplar in the previous 21 completed practices. These are parameterized
  compositions, not 1,095 separately painted illustrations.
- Self-review intervals: 1/3/7/14/30/60 days; "Again" returns in ten minutes.
  An early rehearsal does not advance the interval or postpone the due date.
  This is a scheduling heuristic, not measured learning or pronunciation accuracy.
- **Separate weekly preview:** seven original scenes, twelve recurring concepts,
  one local attempt per day, maximum 120 seconds after explicit Go. Same
  deadline after reload; late starts end at the visible daily cutoff.
- Scheduled pilot: November 16, 2026 09:00 through November 22 18:00
  America/New_York. Later weeks follow the same local schedule; Tuesday-Sunday
  open at midnight. This is a schedule, not a funded contest.
- Contextual Head, illustrated About, reduced-motion rabbit orientation,
  browser-local personal statistics and wallet-scoped profiles. Wallet connection
  triggers reverse-then-forward-checked ENS artwork lookup; name/avatar/banner
  can also be loaded explicitly. Your PNG/JPEG/WebP avatar/banner overrides stay
  local (192 KiB each, maximum 2048 × 2048). No Discord OAuth integration.
- Optional personal word library in the notebook dialog: import a local JSON
  export of words you already learned elsewhere. For your own account,
  `node scripts/fetch-duo-words.mjs` creates gitignored `data/duo-words.json`
  from the gitignored `.env`; it paces requests over several seconds each and
  restores your active course. The imported library is saved only in your
  browser; never uploaded, published or graded.
- Family word map and curriculum: 72 concepts in six levels ordered like early
  childhood acquisition (home nouns, wider nouns, numbers, feelings, colors,
  first verbs) across 13 studied languages. Unmarked entries are **machine seed
  content, fluent-speaker review pending** — never fluent or verified; Diné
  bizaad seeds are limited to well-attested nouns, numbers and colors. The
  scene library's concept pool widens with the same levels. ● evidence and the
  Spanish anchor search come only from the locally imported word library, and
  ▶ plays clearly labeled device speech synthesis.
- Touch objects/words to hear reviewed community recordings in rotation, or
  clearly labeled device speech when a matching voice is installed. Microphone
  starts only on Record. Local IndexedDB drafts become public CC BY 4.0 IPFS
  submissions only on Publish, followed by an explicit GitHub review link.
  **No reviewed recordings ship initially.** No fabricated native-speaker audio.
- IPFS: existing DecentBusking shared service, your own session-only Pinata JWT,
  or a local Kubo API. Shared writes require the Busking service's configured
  mint-owner wallet, not just contributor eligibility. Other learners should
  select their own provider. Health/CORS readiness was checked live; **no signed
  production write was performed for this release**. Public practice backups are
  reported verified only after gateway SHA-256 matches the uploaded bytes.
  Different local records and active practice block restore; no silent overwrite.
- Reviewed five-member pilot snapshot includes existing Busking contributors,
  GrannyLyn and Bobdub by explicit steward direction. It is not live registration
  sync or wallet-control/financial authorization.

**Weekly payments remain unavailable.** Local clocks, answers and history are editable,
not financial evidence. The [empty trial escrow](docs/Trial-Contract.md) is
deployed on Base and exactly source-matched by Sourcify. No funded round was opened.
Trusted score/operator review and real transaction-flow acceptance remain launch gates. No Supporter
token has been minted; no token purchase link is invented. Private LiveKit
adapters are implemented but need operator configuration and a two-device audio
trial; calibrated speech assessment remains future work. The free practice schedule
and self-reviews do not change weekly qualification or authorize settlement.

## Scene stewards

Scene narration supports local recording, segmented call-and-response and
three assigned language-qualified reviewers: two approvals admit that exact
version to local rotation. Local qualifications and votes are prototype records,
not financial authorization. Qualified plays accumulate exact provisional units,
including tiny balances; usefulness votes are separate from correctness reviews.
Ommm settlement and DNFT claims remain disabled until assets, funding and
authorized signers are configured. The new narration/reward contract is tested
locally, not deployed.

Learning gems have a separate [Base Ommm reserve](docs/Ommm-Reserve.md):
4,400 initial inventory tokens, 0.44 USDC bootstrap, proportional burn/redemption,
steward-reviewed awards and non-diluting future mints after reaching 1 USDC
backing. The notebook reads confirmed balances/backing on explicit refresh and
offers wallet-confirmed redemption. The reserve is deployed and funded; receipts
are in the [public manifest](public/dlang/ommm-deployment.json).
Neither local practice nor narrator accruals can
issue or spend these gems.

Scene-grounded typed conversation works without an account or a transcript store.
Private audio is opt-in, starts listen-only and stops during scored attempts.
The optional service exports `createConversationTransport`,
`createConversationService` and `handleConversationRequest` from
`services/conversation.cjs`. An operator supplies the LiveKit server SDK and
backend-only credentials, exact allowed origins, admitted wallets and quotas;
pass the service, origins and exact WSS origin to `createServer` as
`conversationService`, `conversationOrigins` and `conversationLivekitOrigin`.
The default server does not configure this service.

For private audio, load a licensed same-origin LiveKit client SDK exposing
`window.LivekitClient` and set `window.DLangConversationConfig` with `endpoint`
(the service URL ending `/api/dlang/conversation`) and `livekitOrigin`
(the exact `wss://` origin). Use one service instance per LiveKit project;
allow that exact WSS origin in the hosting CSP. Pages alone cannot run the
backend. Without configuration the UI stays in typed practice.

## Run and test

The landing uses the steward-supplied `DLang_Landing_Animated.mp4`: the desktop
composition is unchanged; the silent mobile edit crops at x=800, placing the
window above the study table/book. Still posters load first; reduced-motion
visitors choose whether to play. Animation is muted, pausable and stops in
background tabs. The icon rail opens daily discoveries, curriculum/word map,
voices and the observation week; Escape closes a panel and returns focus.
Closing voices stops the session/capture rather than leaving hidden audio running.

Reuse: adapted Busking's icon-tab/edge-panel interaction from
`css/styles.css` (`#top-ten-tab`, `#top-ten-panel`) at
`ab7c1dd4a25479d0b8351e42b17b8fac6c7c0221`; inspected its dirty working tree
without importing unfinished changes. DLang keeps existing module-owned DOM,
uses nonmodal labeled panels, and adds focus/keyboard, consent, mobile video
dimensions and no-horizontal-overflow receiving tests. No Three.js or radio
runtime is imported. Monthly Runway art improvements are tracked in issue #6.

Node 22 or later:

```sh
npm ci --ignore-scripts
npm start
npm test
npm run build:library
npm ci --prefix contract-tools --ignore-scripts
npm run test:contracts
npm run prepare --prefix contract-tools
npm run test:base-fork --prefix contract-tools
```

Default preview: `http://127.0.0.1:8888/`. `PORT` and `HOST` may select another
loopback port. Browser tests need Playwright Chromium already available, or
`npx playwright install chromium` after a missing-browser failure. Contract tests
run entirely on local Ganache; no chain writes or private keys.

The optional fork test reads public Base state and sends transactions only to
local Ganache. It passed against native USDC at Base block 55819909 for entry,
settlement, owner claim and shutdown refund. `BASE_RPC_URL` can select an RPC;
the official Base endpoint worked after PublicNode archive/cache requests blocked
the first attempt. Preparation creates ignored compiler artifacts and an unsigned
transaction review in `contract-tools/build/`; it never signs or broadcasts.
The L2 fee estimate excludes L1 data fees and is not the full deployment quote.
See [pilot configuration](docs/Pilot-Configuration.md) for the remaining gates.

`public/` is the complete static frontend. Static hosting needs no signing secret
or private registry; eligibility loads the reviewed public pilot snapshot only
after an explicit check. Production Pages publication does not activate payments.

## Shared voices and IPFS setup

The voice studio handles local recording, preview, deletion and explicit public
submission. The prefilled issue link is not sent automatically. A fluent steward
must listen and review word/language, safe content, speaker credit, native-speaker
declaration, duration and CC BY 4.0 permission before running:

```sh
node scripts/approve-voice.mjs --metadata-cid CID --reviewer "Public reviewer credit" --auditioned
npm test
```

The importer fetches bounded metadata/audio and checks size, SHA-256, schema and
duplicate CIDs before changing the local reviewed manifest. `--auditioned` is a
human assertion, not automated pronunciation detection. Commit/publish the
reviewed manifest to enable rotation. Do not review or publish someone else's
voice without their permission.

Use **My IPFS connection** to choose a provider and check it. Personal Pinata JWTs
stay in tab memory and are sent only to Pinata's API, never saved in localStorage.
For Kubo, allow this exact site origin and POST in the node's API CORS settings;
do not expose an unauthenticated API publicly. Browser local-network permissions
and HTTPS/mixed-content policies may prevent local access; failures remain
visible. Gateway reads are bounded and uploads are limited to 2 MiB.
Public backups contain practice records only, excluding profile artwork, weekly
stories and voice drafts. Public IPFS content can persist; removal of local data
cannot recall public copies. No upload happens without its labeled action.

The materialized [year library](public/dlang/year-library.json) contains 1,095
recipes and exact SVG SHA-256 checksums. Rebuild with `npm run build:library`;
tests verify reproducibility, target geometry, vocabulary coverage, all checksums
and a complete 365-day simulation for both perfect and mixed self-reviews.

## Authorized deployment operators

```sh
npm run deploy --prefix contract-tools -- --env /path/to/authorized.env
```

Default behavior is a **read-only dry-run**. The selected file must provide
`DEPLOYER_PRIVATE_KEY` for the reviewed steward address; it is loaded only in the
local process, never copied, printed or published. Keep it outside this repository.
The dry-run checks source, constructor roster, nonce, native-USDC code, L2 gas,
conservative L1 bounds and the 0.001 ETH cap. Nonzero operator fees are refused
pending a reviewed calculation.

Only the additional `--broadcast` flag signs and sends. It requires a matching
preflight less than ten minutes old and journals the hash before broadcasting,
so a timeout/error cannot silently trigger a second deployment. Reconcile any
recorded transaction manually; never delete the journal to retry blindly.
Runtime source and immutable configuration are checked after three confirmations.
This deploys an empty escrow: no round opening, USDC approval or UI payments.
Protocol fee changes remain external risks despite conservative bounds.

## Reuse and licenses

Need: a standalone DLang receiving app without old sandbox runtime. Adapted only
the selected DLang page/modules/tests from a local prototype based on preparation
commit `d1ad556493c55d3a0a2119ca15d4e492f3fd0d25`, plus explicitly uncommitted
profile/About/five-language work. No legacy watcher, provider, wager runtime,
payroll registry, repository history or private configuration was imported.
The [source notice](LICENSES/BabelBet-NOTICE.txt) is required legal provenance,
not product affiliation.

DecentHead version 2.0.0 retains vendor licenses and an explicit host About bridge.
ENS patterns adapt Busking's `js/ens-client.mjs` reverse/forward ownership check
and avatar/banner/header records. Shared upload interoperability implements the
exact `buildUploadAuthorizationMessage` protocol in `js/ipfs-upload.js`, inspected
at Busking commit `ab7c1dd4a25479d0b8351e42b17b8fac6c7c0221`. No Busking profile
backend was copied: its worker/auth/storage runtime differs. The receiving app
uses the existing hosted signing endpoint, with explicit mint-owner restrictions,
plus independent personal providers; no speculative shared framework is extracted.
Receiving fixtures validate the exact signature text, destination allowlist,
credential boundaries and gateway-byte recovery; live origin preflight and health
pass but do not establish authorized-write acceptance. Exact token balance checks adapt
DecentEscrow's Apache-2.0 PaymentAsset; trial accounting is new and separately
tested. No speculative shared framework is extracted.

Receiving tests cover language packs, timer/weekly boundaries and DST, local
persistence, accessibility, ENS/profile artwork, three-a-day practice, actual
statistics, device speech, local microphone drafts, public-backup verification,
provider failures, native-voice approval/rotation, About/tutorial and wallet refusal.
Contract tests cover refunds/carry/settlement separately; see the contract guide
for trust assumptions and remaining launch gates.

For native narration, adapted exact-unit and replay-protection patterns from
Busking's `js/radio-payroll.mjs` and `discord-bot/payment-ledger.js` at
`ab7c1dd4a25479d0b8351e42b17b8fac6c7c0221`, ArtFi's
`contracts/ArtFiSettlementRouter.sol` at
`4c402808ff9c9f78543a9416928fc05678181f8c`, and Voyager's
`VoyagerRewards.sol`/`VoyagerStamps.sol` at
`d81a611bb1bff6585bba681ee65482e424aa53ec`, without importing donor deployments.
Conversation adapts Busking's `js/rehearsal.mjs` and
`discord-bot/rehearsal.js` at `ac8a9cc`; its hosted identity and persistence
are not reused. DLang-specific receiving tests cover consent, expiry, wallet
changes, weekly isolation, version-bound reviews, exact accrual and signed-claim
replay refusal. Different assets, funding authority and native-reviewer
qualification still require operator setup. DVERT and subscription funding
remain separate follow-up work.

Code: Apache-2.0. Original creative material: CC BY 4.0 unless otherwise marked.
Preserve [NOTICE](NOTICE), donor notices and vendor licenses.
