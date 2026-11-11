# DLang

Notice, name, narrate. An independent visual language-learning application:
seven original seek-and-find scenes, twelve recurring concepts and simultaneous
multilingual study. DLang is not affiliated with any commercial lesson platform.

## Current availability

- English, Spanish, French, Hindi (Devanagari) and Mandarin Simplified with pinyin.
  All vocabulary/aliases are seed content, **not fluent-speaker reviewed**.
  Pinyin is a study aid; scored Mandarin answers use Chinese characters.
- One local attempt per day, maximum 120 seconds after explicit Go. Same
  deadline after reload; late starts end at the visible daily cutoff.
- Scheduled pilot: November 16, 2026 09:00 through November 22 18:00
  America/New_York. Later weeks follow the same local schedule; Tuesday-Sunday
  open at midnight. This is a schedule, not a funded contest.
- Contextual Head, illustrated About, reduced-motion rabbit orientation,
  local personal profile/image, optional self-entered ENS/Discord links and history.
  There is **no verified ENS-avatar or Discord OAuth integration**.
- Reviewed five-member pilot snapshot includes existing Busking contributors,
  GrannyLyn and Bobdub by explicit steward direction. It is not live registration
  sync or wallet-control/financial authorization.

**Payments remain disabled.** Local clocks, answers and history are editable,
not financial evidence. The [trial escrow source](docs/Trial-Contract.md) is not
deployed or mainnet-ready. Trusted review, deployment
verification and real transaction-flow acceptance are launch gates. No Supporter
token has been minted; no token purchase link is invented. Voice/LiveKit is
future work, not implemented.

## Run and test

Node 22 or later:

```sh
npm ci --ignore-scripts
npm start
npm test
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
Busking's profile/About concepts informed local consent/link/image presentation;
its authenticated backend is **not** integrated. Exact token balance checks adapt
DecentEscrow's Apache-2.0 PaymentAsset; trial accounting is new and separately
tested. No speculative shared framework is extracted.

Receiving tests cover language packs, timer/weekly boundaries and DST, local
persistence, accessibility, profile consent, About/tutorial and wallet refusal.
Contract tests cover refunds/carry/settlement separately; see the contract guide
for trust assumptions and remaining launch gates.

Code: Apache-2.0. Original creative material: CC BY 4.0 unless otherwise marked.
Preserve [NOTICE](NOTICE), donor notices and vendor licenses.
