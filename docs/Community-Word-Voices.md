# Community WORD pilot

The receiving need is a **word-sized** contribution at the point of hearing:
Discover, the scene library and study labels expose **Fix pronunciation**.
Record and Publish remain separate. Long AI-voice onboarding is not required.
Public wallet/ENS credit must match the signing contributor; language,
dialect/accent and native status are self-declared;
whitelisted learners are eligible too. A saved per-language browser profile
helps with the next word; consent is never remembered as an automatic opt-in.

## Intentional pilot policy

The user chose immediate publication by the short reviewed wallet whitelist,
visibly **unreviewed**, including normal word playback. This differs from the
legacy static manifest's steward-approved-only policy. Every hosted recording
retains its exact scene/language/concept snapshot, immutable sample SHA-256/CID,
credit, dialect, declaration, consent scope and wallet-signed payload hash.
Publishing does not automatically flag anything or close an existing flag.

Thumbs mean **clear and helpful for learning, not whether I like the accent**.
There is one replaceable thumb per wallet per recording, no self-voting, no
self-approval, no vote-created verification or consent. An independent,
operator-configured native language reviewer may approve/reject the exact
recording version; thumbs do not constitute that review. A rejected recording
does not play. Flags remain open until a separate resolution workflow exists.

Word selection mixes hosted candidates with the existing approved static
manifest when available. Reviewed recordings have a stronger weight;
self-declared native status is a weaker preference, never verified status.
Bounded, smoothed clarity feedback affects selection weight. A repeated speaker
gets one-quarter weight and, when another is available, cannot play more than
twice consecutively. This preserves both variety and a real quality preference
rather than forcing equal alternating shares. Learners and different dialects
remain eligible. IPFS bytes must match the retained hash and size before both
publication and playback.
Existing device synthesis and unavailable/error states remain labeled.
Scored sessions cannot record, publish, vote or play these words.

## Hosting and persistence

`server.js` enables the service only with:

* `DLANG_WORD_ORIGIN`: exact hosted HTTPS origin; loopback HTTP for tests.
* `DLANG_WORD_STORE`: explicit absolute JSON path on an **existing, durable**
  operator-owned directory. One service process owns this file; do not run
  replicas against it. Writes are serialized, synced and atomically renamed.
* `DLANG_WORD_REVIEWERS`: optional JSON array of `{id, languages,
  nativeSpeaker:true}` profiles. `id` is a whitelisted reviewer wallet;
  language qualification is an operator decision, not a speaker declaration.

The server reads the existing `public/dlang/pilot-roster.json` reviewed
snapshot. This grants only scoped WORD contribution eligibility, not general
admin, financial authority or live registry synchronization.
Two-minute, one-use wallet challenges bind origin, action and exact payload.
Publication, flags, feedback and independent review survive a verified store
reload. The registry contains public attribution and wallet associations;
do not put private biographical data in a public voice profile.

The operator approved a 1 GB Render disk at $0.25/month in addition to the
existing $7 instance. It is mounted at `/var/data`; the configured WORD store
is `/var/data/community-words.json`, and the exact origin is
`https://dlang-stewards.onrender.com`. Disks disable zero-downtime deployment
and multi-instance scaling; retain the single-process constraint.
Do not point the store at an ephemeral checkout and claim durable hosting.
If persistent storage is missing or initialization fails, `/api/words` returns 503,
and the UI says drafts remain local; GitHub Pages cannot run this mutation
service. No hosted persistence success is inferred from a health check.

Audio uses existing `storage.mjs` IPFS uploads and the Decent head's provider
controls. Word audio explicitly selects DecentBusking's existing
`/api/ipfs/submission-upload-url` artist-media route, with its exact signed
artist authorization message. The separate `/api/ipfs/upload-url` mint-owner
route remains unchanged for practice backups. DLang's exact hosted origin
was added to Busking's existing `IPFS_ALLOWED_ORIGINS`, preserving all others;
the existing built service was redeployed without publishing donor code.
This generic artist-media pinning route has its own wallet limits, not the
DLang whitelist; the DLang registry independently enforces the short roster.
No contributor receives the operator's Pinata JWT.
The WORD eligibility signature precedes an irreversible upload; a separately
signed final publication binds the actual CID and sample hash. If final
publication fails, the public upload may remain and the UI reports incomplete
publication, not a registered contribution.

IPFS Desktop's exact-origin CORS allowlist now includes the hosted DLang origin
with prior origins preserved, following explicit operator restart approval.
Select **My Kubo / IPFS Desktop** in the head's IPFS controls, keep API
`http://127.0.0.1:5001`, then Connect. Local reads use Kubo `cat` so a locally
pinned word need not wait for a public gateway. Allow browser local-network
access if prompted. Desktop must remain running to serve its local node;
one local pin is not a guarantee of permanent network availability.

Real storage acceptance used the already-public wind derivative, not a human
word or private sample, and a disposable fixture signer. Both shared Pinata
and IPFS Desktop pinned and recovered the same 33,061 bytes with CID
`bafkreiehmjeaktlvwi2owo7f4nk5j2hhadai66uwvigqgqolbdqh3ws24i` and SHA-256
`876248054d75b234eb3be5e355d4e8e700c08f7a96aa0d0341cb08e07dda5ae2`.
No fake speaker record, vote, gem reward or AI voice was published.

## Using the trial

1. Open Discover (or a study/library scene), choose a language and touch an
   object. **Fix pronunciation** beside the selected word opens its studio.
2. To report the heard pronunciation, choose **Flag pronunciation in this
   scene** and sign with an eligible wallet. This does not start recording.
3. To contribute, **Record this word**, say only that word, then stop and
   **Listen to my draft**. Recording is explicit and capped at 15 seconds.
4. Enter your matching wallet or Ethereum `.eth` credit and self-declared accent/dialect. Native status is
   optional; whitelisted learners are welcome. Confirm own-voice public CC BY
   consent only if you agree. **Publish word** requests scoped wallet signatures
   for eligibility, the selected pinning provider, and the exact final record.
   These are not transactions or cloning permissions.
5. The byte-verified recording enters the shared rotation as **UNREVIEWED**.
   Hearing another contributor enables clarity thumbs; your thumb replaces
   your previous one. The small information disclosure explains the limits.

Playback and recording stop for private audio, panel navigation and hidden
tabs. Scored practice prevents contributions. There is no auto microphone
capture or automatic private-voice upload.

## Separate one-week funded reward implementation

The approved voice-reward pilot is a **separate** $1 native Base USDC-backed
Ommm pool for November 16–23, 2026, Monday 00:00 New York to the next Monday,
end exclusive. It uses signed independent audible completions, allows deliberate
repeats, and allocates the fixed 10,000 Ommm inventory proportionally once after
the week. Thumbs affect rotation, not play credits. Existing learning funds and
holders remain untouched. No hosted earning/funding claim is made until the
parent broadcasts and verifies funding and configures the durable service;
unconfigured rewards return explicit 503. See
[Voice-Reward-Pilot.md](Voice-Reward-Pilot.md) for qualification, trusted-browser
limitations, recovery authority and the parent-only deployment/settlement plan.
Sentences, scene observations, call-and-challenge and all-word voice expansion
remain gated future work. Public WORD consent authorizes neither cloning,
provider voice enrollment, all-word synthesis nor call impersonation.

## Reuse decision and acceptance

Consulted DecentCanopy `data/agency-map.json` DecentBusking scoped-upload,
durable-checkpoint and fund-ledger offers; inspected actual donor source,
tests, worktrees, recent commits and current issues/PRs read-only.
Donor checkout HEAD `ab7c1dd` contains extensive **uncommitted changes**,
including the following reference surfaces:

* `js/listens.mjs:createListenController` and `test/listens.test.js`:
  session-bound playback cancellation; no copying of paid preview behavior.
* `discord-bot/jukeloop.js`: completed audible playback and weekly play
  qualification (30 seconds, unsuitable for 0.2–15 second words).
* `discord-bot/weekly-payflow.js`: available-fund proportional budgets;
  `discord-bot/fund-ledger.js` and `payment-ledger.js`: coverage/error and
  exact-unit accounting references. These are not a DLang reward ledger.
* `js/radio-sync.js:sendRadioVote`: play-bound radio votes are not a substitute
  for signed, recording-bound clarity feedback.

Busking's Base USDC/NFT/Discord radio identities, timing, funding and provider
authorization differ from DLang public CC BY word audio and wallet whitelist.
No whole-library/license compatibility is claimed;
the inspected donor checkout has no root tracked LICENSE. No donor code was
copied, extracted, modified or published. Adapted DLang's existing
`audio.mjs` recording/hash/size/stop primitives, `steward.mjs` canonical hashes/
scene snapshots/reviewer eligibility, wallet signer and server conventions.
Built a small nonfinancial WORD registry rather than importing Busking's
paid-play and settlement system.

Receiving acceptance: `test/dlang-community-words.test.cjs` covers immediate
learner publication, retained scene/sample hashes, signed action/context
binding, expiry/replay refusal, durable reload, independent review,
replaceable thumbs, diversity/weights, open flags and unavailable hosting.
`test/dlang-community-words-browser.test.cjs` covers simulated word-sized
recording/publication, attribution, thumbs, interruption and scored guards.
Legacy storage/audio and scene/tutorial browser tests cover retained defaults.
All browser microphone/audio/signatures are test doubles for disposable
fixture wallets, never a real person's recording or identity.
