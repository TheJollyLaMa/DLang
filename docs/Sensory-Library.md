# A reusable sensory library

Open **Voices → Sensory library** for saved sound and image candidates.
Nothing plays automatically. Six short AI-generated cues cover cat, bird,
wind, rain, bicycle bell and a nonverbal curiosity/surprise chime. These are
not pronunciation examples: sound words and emotional interpretations vary
between languages and cultures. The twelve visual candidates cover familiar
objects, with desktop/mobile PNGs and small lazy-loaded WebP previews.

All first-batch assets are **drafts awaiting human recognition and rights
review**, not approved lesson replacements. The existing scene renderer and
device speech remain available. No fluent-speaker approval is fabricated.

Choose **Gentle scene motion** to animate trees, flowers, cats and birds in
study, library and free-practice scenes. Motion uses CSS transforms rather
than downloaded video and preserves scene target positions and recipe hashes.
It is off by default, respects reduced motion, and stops when the document is
hidden, no learning panel is open, scored practice is running, or private
audio is active. Sound previews stop on speech/narration, recording, private
audio, navigation, hidden tabs and scored practice. They never loop.

### Weather loudness revision

November 13 listening feedback accepted cat, bird, bell and surprise; wind
and rain were barely audible. Their original mean levels measured -50.5 and
-44.0 dBFS, before the player's unchanged 30% volume. Local constant-gain
derivatives add 20.5 dB to wind and 14 dB to rain, reaching approximately
-30 dBFS mean with peaks below -11 dBFS. No regeneration credits were used.
The four accepted cues and global playback volume are unchanged.

The catalog selects the weather `v2` derivatives while retaining the `v1`
originals, hashes and processing measurements. Reproduce/check with
`node scripts/normalize-weather-sounds.mjs` (requires ffmpeg); rerunning checks
the existing derivative rather than increasing gain again. Browser tests
decode both versions, verify the actual RMS improvement and peak headroom,
and preserve the short duration. Human re-listening is still required before
weather recognition approval; technical loudness checks are not that approval.

## What is saved

- `public/dlang/sensory-catalog.json`: additive asset IDs, concept IDs, source
  prompts/models, generation dates, source/served SHA-256, sizes, draft status,
  batch allowance and observed provider usage. No private samples or keys.
- `public/dlang/sensory/YYYY-MM/`: reusable MP3, PNG and WebP files; stored in
  git with the app, not temporary provider download links.
- Private ignored `data/sensory/YYYY-MM/`: original provider outputs and
  per-request journals/task IDs. Back this directory up privately if retaining
  original generation files is important; git contains the served derivatives,
  not these ignored originals.

No background scheduler, monthly purchase, automatic top-up or regenerate-on-play
path is installed. Each future month's batch needs explicit approval and human
review. New batches append IDs; they do not erase prior months. Withdraw assets
from rotation by setting their catalog status to `withdrawn`, retaining
provenance/history. Publicly downloaded copies cannot be recalled.

## November 2026 pilot

The user approved up to 5,000 existing ElevenLabs credits for sound effects,
with no top-ups, and confirmed a 1,000-credit Runway API trial. A read-only
API check confirmed the trial balance. This pilot reserves at most 480
ElevenLabs credits (six two-second effects at the documented conservative
40-credit/second rate) and 60 Runway credits (twelve Gen-4 720p stills at five
credits each). The actual Runway balance fell from 1,000 to 940.

ElevenLabs usage reporting is delayed: catalog observations taken during
generation are **not final billing totals**. Check the provider dashboard
before allocating the remaining monthly allowance. No voice clones or voice
synthesis were generated as part of this sound batch.

## Operator workflow

These are explicit spending commands, not development/test commands:

```sh
node --env-file=.env.local scripts/sensory-batch.mjs sounds YYYY-MM
node --env-file=.env.services scripts/sensory-batch.mjs images YYYY-MM
node scripts/stage-sensory-batch.mjs YYYY-MM
```

The generation tool journals intent before each request, uses no automatic
ElevenLabs retry, keeps Runway task IDs for polling, and refuses an ambiguous
request without a task ID. Investigate provider state before any manual retry.
It skips already saved assets. Never remove a journal simply to retry a paid
request. Provider-reported usage may lag or include other account activity;
the fixed seed count and conservative per-request reservations bound this
pilot, not the whole account. Provider account billing controls remain separate.

Staging requires `ffmpeg`/`ffprobe`, verifies original hashes, decodes sounds,
creates bounded image derivatives, and appends only `draft` entries. It does
not approve artwork for lessons. After human visual/language/recognition and
rights checks, use the existing reviewed artwork import workflow described in
[Artwork-Workflow.md](./Artwork-Workflow.md). Keep stable concept IDs and
document the reviewed batch's provenance instead of regenerating its assets.

## Contributor AI voices: a separate private pipeline

**Voices → Contribute my AI voice** prepares a signed opt-in for approved
adult contributors. It is not consent inferred from a LiveKit call or a
CC BY recording. The dedicated sample is previewed locally; only its hash,
language, terms, origin and wallet are signed. The request remains in this
browser until explicitly downloaded. Arrange private operator delivery;
never post sample audio or signed consent in a public GitHub issue or IPFS.

The whitelist is the reviewed contributor snapshot, not the broader voice-call
admission list. A wallet signature proves control of an address, not adulthood,
speaker identity, sample ownership or legal eligibility. An operator must
verify those independently before provider upload. No clone is activated
merely by signing; this is a manual pilot, not a hosted private submission inbox.

For private operator inspection, without uploading:

```sh
node scripts/voice-seed.mjs inspect private-request.json private-sample.wav
```

An operator approval JSON must contain the matching `requestId`, `sampleHash`,
`approvedBy`, `approvedAt`, and true declarations for `adultEligibilityVerified`,
`speakerOwnershipVerified`, `retentionExplained`, `dedicatedSampleReviewed`.
Never invent these attestations. Once genuinely reviewed and authorized:

```sh
node --env-file=.env.local scripts/voice-seed.mjs clone private-request.json private-sample.wav private-operator-approval.json
```

The official ElevenLabs SDK stores a private clone receipt under ignored
`data/voice-seeds/`. It remains **generation-disabled pending speaker preview
and qualified language review**. Do not retry an ambiguous clone request;
inspect the provider and receipt. No arbitrary learner text, live AI
conversation, global voice sharing or automatic replacement of existing speech
is enabled. Reviewed synthetic lesson playback/activation is a remaining gate.

The receipt records two reward **intents**, one-time approved voice and
reviewed narration usage, with no amounts. Rates, caps, abuse checks, funded
settlement and award authority are not configured. Nothing is earned or paid
just for ticking a box, uploading repeatedly, or spending time in a call.
Existing contracts and participant funds are unchanged.

Contributors can sign and download a withdrawal from the same browser/wallet.
It is **not delivered** until privately sent to the operator; request
acknowledgement. If browser storage is lost, contact the operator for the
original consent record and a fresh signed withdrawal. Operator command:

```sh
node --env-file=.env.local scripts/voice-seed.mjs withdraw private-withdrawal.json private-clone-receipt.json
```

This disables the local receipt before requesting provider voice deletion.
Failure leaves deletion pending and generation disabled. Remove any related
generated lesson assets from rotation separately; downloaded copies and
provider logs/backups cannot be guaranteed erased. Apply private storage,
retention, deletion, backups and access controls before scaling beyond this
manual pilot. No private provider key belongs in Render's public assets.

## Reuse and validation

This adapts DLang's existing `storage.mjs` digest, `pilot.mjs` eligibility,
audio stop/turn player, white-rabbit tour and panel routing at `31efb44`.
The Canopy curated map and DLang's existing scene/artwork import were the
reuse search scope; no new parallel rendering or wallet-auth stack was built.
Actual image approval continues through the established importer. LiveKit
remains transport only, independent of cloning and reward accounting.

Run `node --test test/dlang-sensory.test.cjs` for saved-media hashes, bounded
previews, consent signature/scope/whitelist, private local request handling,
desktop/mobile preview playback, reduced motion and live-audio interruption.
Automated checks do not constitute human voice/recognition/rights approval.
