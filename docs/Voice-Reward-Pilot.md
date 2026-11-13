# One funded voice week

## Confirmed funding

The separate pool is deployed at
[`0x8fff93A94eDe08c462C2e6D1A61FE64Fb2F3aDB1`](https://basescan.org/address/0x8fff93A94eDe08c462C2e6D1A61FE64Fb2F3aDB1).
Exactly $1 native Base USDC was collected by
[`bootstrap`](https://basescan.org/tx/0x3282b9e5a51f2a853d5e8a2efa8c661d996c7b6cbcfc77420129c5d070ff2799).
The [public funding evidence](../public/dlang/voice-pilot-funding.json)
matches the confirmed runtime, bootstrap event and USDC transfer.
Startup gas including deployment, exact approval and funding was
0.000019001540707905 ETH, within the additional 0.001 ETH cap.
The exact USDC allowance was consumed; existing learning pools' USDC balances,
supplies and pilot-holder balances were verified unchanged against preflight.
No contributor payout or human-play receipt is implied by funding.

**Approved window:** Monday **November 16, 2026 00:00** through Monday
**November 23, 2026 00:00**, end exclusive, **America/New_York**.
UTC boundaries are `2026-11-16T05:00:00Z` and `2026-11-23T05:00:00Z`.
There is exactly one funded week, no cron funding, subscription, rollover award,
ETH swap, learning award, or automatic recurring contribution.

`OmmmVoicePilot` adapts the existing Apache-2.0
`contracts/dlang/OmmmStaircase.sol` reserve, steps, redemption, dividends,
recipient-bound claims and two-step ownership. It creates a **different pool**,
restricted to native Base USDC at
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
Bootstrap must occur **before** the first boundary and collects exactly
**1,000,000 USDC base units ($1)** against **10,000 × 10^18 Ommm units**.
Initial backing is $0.0001 per Ommm, **not a market-price guarantee**.
Bootstrap refuses a preexisting USDC balance rather than silently claiming
more than $1 initial backing; unsolicited pre-funding requires operator
reconciliation, not an additional debit or a fictitious funded receipt.
Constructor inventory cannot be awarded before funding. Extra `fund`,
`fundAndMint`, `awardDay` and `awardLevel` paths are disabled in this pool.
Existing deployed learning contracts, funds and holders do not migrate.

The prototype owner can recover **all assets, including holder backing and
dividend liabilities**, permanently retiring this pool. Historical balances
remain but payouts cease. Recovery is enabled by default; no automatic sealing
or ownership transfer occurs. Later group custody uses `transferOwnership` /
`acceptOwnership`, with an explicit separate decision about permanently
disabling prototype recovery.

## Qualification and exact allocation

Contributor enrollment is signed and independently validates the matching
wallet or ASCII `.eth` credit using `identity.mjs::resolveContributorCredit`
against Ethereum mainnet. The durable enrollment retains the exact signed word
publication. Old nickname records can remain playable but need an explicit
matching-credit enrollment before earning. New studio uploads verify credit
before an irreversible upload; apparent wallet/ENS credits are also checked
server-side. Nothing here grants cloning or provider enrollment consent.

An opted-in, deliberate word gesture requests a signed, server-bound session.
Only an independent whitelisted listener can start it. One active session per
listener, bounded .2–15 second recording duration, elapsed server time,
120-second durable one-use challenges, exact payload hashes, pool/week/origin,
signature verification and completion markers prevent service replay and
instantaneous click earnings. Session expiry is duration plus 30 seconds,
clipped to week end. Restart preserves authorizations, sessions and receipts.
Interrupted sessions earn nothing; they expire automatically or can be
explicitly signed-discarded. Each new intentional complete practice can earn
another credit; repeat practice is not blanket deduplicated.

The browser refuses hidden, muted, paused, stalled, interrupted, sought or
speed-altered playback and checks the real media duration/end boundary.
Scored/private audio, scene narration, local drafts, legacy static voices and synthesis do not
participate. Start and completion also reverify the funded pool, failing closed
on unavailable RPC or retirement. **Browser audibility and human intent cannot
be cryptographically proven**: signatures attest them to a trusted prototype
operator; a malicious signed client can lie. This is not a trustless listening
oracle, anti-Sybil proof or proof that a speaker is native. Word duration is
publisher metadata checked against browser decoding, not independent server
media analysis. Wallet prompts and strict interruption policy can reject
otherwise genuine plays; rejected plays are never reported as earnings.
New recordings store their decoded audio duration, not elapsed recorder wall
time. Chrome's streaming WebM initially reports infinite media duration and
can contain less audio than the recording timer; the native end event supplies
the final duration. A real MediaRecorder waveform regression verifies this
path as well as WAV playback, without recording a person or publishing audio.

Clarity thumbs affect existing quality-weighted, diversified selection only.
They never create funded play credits. Each qualified complete play contributes
one credit to its contributor. At week end, BigInt proportional division plus
deterministic largest-remainder dust allocates exactly the fixed 10,000 Ommm
inventory; rounding is at 10^-18 unit precision, not dollars/floating point.
Sorted unique recipient arrays are transferred **atomically once** on-chain.
The evidence hash binds funding and the complete signed receipt set.
**Zero qualifying plays emits `VoiceWeekCarried` and retains all inventory**;
it is not a successful payout or permission to finance another week.

## Parent-operated deployment and settlement

Implementation tests do not certify live human audibility or payout.
Original issues remain open. Node **22.13+** is required
for the existing canonical-JSON ESM helper's synchronous CommonJS reuse.

From `contract-tools/`, all commands default to **no broadcast**:

```sh
node voice-pilot.mjs preflight
node voice-pilot.mjs deploy
# After reviewing each plan, the parent alone supplies the approved
# DLANG_VOICE_PRIVATE_KEY and explicitly adds --broadcast to transaction steps.
node voice-pilot.mjs deploy --broadcast
node voice-pilot.mjs approve --broadcast
node voice-pilot.mjs fund --broadcast
node voice-pilot.mjs manifest
node voice-pilot.mjs verify
```

Preflight requires the administrator's existing native USDC balance to cover $1;
it never exchanges ETH or takes learning-pool assets. A read-only November 13
preflight initially found only **37,882 USDC base units ($0.037882)** at the approved
administrator. After the operator supplied funds, the final preflight found
**1,055,546 base units**, and exactly **1,000,000** were used for this pool.
No ETH swap or learning-pool withdrawal was made.
Do not silently fund late or substitute a new week.

Default private operator journal: `contract-tools/build/voice-pilot/journal.json`
(override with `--journal`). Exclusive lock, synced atomic renames, pre-broadcast
signed transaction/hash/nonce persistence, two-confirmation receipts, exact
Base L1 fees, runtime/immutable comparison and retry reconciliation are used.
A crash retries the **same transaction hash**, never a fresh duplicate payout.
Failed transactions and stale locks require explicit operator reconciliation.
The **additional cumulative** gas cap is **0.001 Base ETH**, separate from the
$1 USDC and existing learning deployment costs. Startup reserves 0.0003 ETH
for settlement; every write rechecks the remaining budget, current gas estimate,
L1 upper-bound estimate and wallet balance. Missing fee data stops execution.
Base L1 fees are protocol-determined and can change before inclusion: the
estimate has a safety margin but is not a mathematical bound on future fees.
Any actual overrun stops all further writes rather than silently replenishing.

`manifest` writes the verified funded identity to `build/voice-pilot/funding.json`.
After reviewing and verifying it, the public immutable funding evidence may
be deployed with the application (JSON identity must match the generated
manifest). Configure:

* `DLANG_WORD_STORE=/var/data/community-words.json` (existing).
* `DLANG_WORD_ORIGIN=https://dlang-stewards.onrender.com` (existing).
* `DLANG_VOICE_REWARD_STORE=/var/data/voice-rewards.json`.
* `DLANG_VOICE_FUNDING_MANIFEST=public/dlang/voice-pilot-funding.json`.
* Optional `DLANG_BASE_RPC`, `DLANG_ENS_RPC` (Base and Ethereum mainnet).

No user/admin key is needed by the hosted service. `GET /api/voice-rewards`
returns 503 unless funding/runtime/receipt and durable storage verify.
The separate reward JSON must have **one owning process**, no replicas,
manual concurrent edits or multiple writers. Both registry files share the
already-approved 1 GB disk; no further disk/provider purchase is introduced.
Pilot limits fail explicitly: 500 pending challenges/sessions, 128 contributors,
10,000 receipt credits (bounded JSON memory on the existing instance; further
plays fail explicitly rather than claiming unfunded earnings). Keep operator snapshots and signatures private;
public API exposes only aggregate credits/enrolled attribution and final
allocation, not listener signatures.

After **November 23 05:00 UTC**, obtain a read-only copy of the durable reward
JSON (no private-data publication), then:

```sh
node voice-pilot.mjs settle --ledger ./operator-voice-rewards.json \
  --origin https://dlang-stewards.onrender.com
# Parent reviews exact allocation/evidence and budget, then adds --broadcast.
node voice-pilot.mjs settle --ledger ./operator-voice-rewards.json \
  --origin https://dlang-stewards.onrender.com --broadcast
node voice-pilot.mjs verify
```

Settlement independently rechecks signed publication/enrollment/start/completion,
whitelist, exact durations, chronology, distinct IDs/nonces and matching ENS
credit; it recomputes every unit and binds one frozen evidence hash. It requires
the matching funded pool and verifies settled state/receipt after broadcasting.
Do **not** replace the hosted funding identity with a later gas-accounting
snapshot: settlement accounting belongs in the separate transaction journal.
Publication order: tests and parent source review → parent-funded verified pool
→ disk manifest/config and hosted code → hosted 503/active-week/restart checks
→ closed-week allocation review → parent settlement → exact event/balance check.

## Reuse decision

Need: backed word-play allocation without altering learning holders.
**Adapt** DLang's existing `OmmmStaircase` and exact scoped WORD signing;
reuse `steward.mjs::canonicalJSON` and the parent's matching-credit helper.
Compared the curated DecentCanopy offers and actual DecentBusking
`discord-bot/jukeloop.js` completed/audible-play boundary,
`js/radio-payroll.mjs::previewPlaybackPayroll` integer proportional shares and
`discord-bot/fund-ledger.js` receipt/accounting separation. These are mechanisms,
not a tested DLang integration: Busking has server-owned Discord audio,
different track identities, 30-second rules, payouts and floor/carry semantics.
DLang adapts the concepts with its own browser attestation, .2–15 second words,
signed whitelist, no-self policy and complete inventory allocation.
Donor working copies/worktrees were inspected read-only; no donor source was
copied (no blanket stage or absent-license assumption), edited or published.
Receiving tests cover signed persistent repeat/abuse qualification, browser
end/interruption and exact backed award/redeem/recovery paths.

Validation before parent integration: `npm test` passed **125/125** application tests;
`npm run test:contracts` passes **59/59** contract tests.
Parent integration added the real Chrome WebM regression; all 26 directly
related recording, playback, persistence and reward tests passed afterward.
Native WAV playback uses a non-human local waveform and isolated test clocks /
visibility; actual human audibility is not certified. Read-only Base preflight
on November 13 estimated **3,614,088 deployment gas** and a startup envelope of
**0.000094159889271888 ETH**, plus **0.0003 ETH** reserved for settlement,
within the additional **0.001 ETH** cap. The parent subsequently funded and
verified the pool as recorded above; the earning week is still future-dated.
