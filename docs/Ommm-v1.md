# Ommm v1: one shared token, many reward pools

Prototype for [#9](https://github.com/TheJollyLaMa/DLang/issues/9). **Deployed on Base November 28, 2026**; receipts in [the public manifest](../public/dlang/ommm-deployment.json).

| Contract | Address |
| --- | --- |
| Ommm (shared token) | [`0xD3244Ac3552e983bdf2b9DD5c0FE51410447b778`](https://basescan.org/address/0xD3244Ac3552e983bdf2b9DD5c0FE51410447b778) |
| DLangOmmmLearningPool (4,400 Ommm budget) | [`0x3B565e005e2d411e252510eAF367cbB1B1FeC5FA`](https://basescan.org/address/0x3B565e005e2d411e252510eAF367cbB1B1FeC5FA) |
| DLangOmmmVoicePool (10,000 Ommm per week) | [`0x9c700aD2bDA94F7a604cd93FEC179088259547c8`](https://basescan.org/address/0x9c700aD2bDA94F7a604cd93FEC179088259547c8) |

Owner: decentagency.eth. Reserve 1.296 USDC; 14,400 Ommm committed, none minted yet. The three earlier Base prototypes were retired in the same run (see their docs). Deploy with `node contract-tools/deploy-ommm-v1.mjs --env <file>` (local fork rehearsal), then `--broadcast`.

Base currently has three separate Ommm tokens (`OmmmReserve`, `OmmmStaircase`, `OmmmVoicePilot`). `contracts/dlang/Ommm.sol` replaces them with one Ommm for DLang and the other Decent apps.

## How it works

- **USDC-backed.** Any holder can `redeem` Ommm for its share of the USDC reserve. Anyone can `fund` the reserve, which raises the price.
- **Pools instead of new tokens.** The owner opens a pool (a wallet or contract, such as DLang learning, DLang voice or DecentBusking) with an Ommm budget. The pool calls `reward(recipient, units, evidence)` to mint up to that budget. Each evidence hash can be used only once.
- **DLang voice** uses `DLangOmmmVoicePool` to schedule a bounded weekly budget, settle a sorted recipient allocation after the week closes, and carry the unspent budget forward when there are no eligible plays. The steward attests the playback ledger; the contract enforces the time window, exact weekly allocation, and one settlement per week.
- **Price = reserve ÷ committed supply.** Committed supply is Ommm already minted plus every pool's unminted budget, so paying a reward never changes the price.
- **Funding rule.** Opening a pool, or adding budget, must deposit enough USDC that the price falls by no more than `maxDropBps`. That limit is 10% by default and can be lowered by the owner, never raised above 10%. `requiredAssets(budget)` shows the deposit needed. The very first pool is priced at the fixed `INITIAL_PRICE` ($0.0001 per whole Ommm).
- **Closing a pool** releases its unminted budget. Its USDC stays in the reserve, so the price rises.
- **Limits.** The owner sets a total supply cap (never below committed supply), can pause rewards, and blocks transfers into the contract.
- **Prototype recovery** follows the DecentAgency rule for contracts that hold funds: the owner can recover all backing, which retires the token, until `disablePrototypeRecovery` is called.

## Configuration before deployment

- The starting price is fixed to the original DLang price: $0.0001 per Ommm (`100` USDC base units per whole Ommm).
- The selected supply cap is **1,000,000 Ommm**. The DLang learning pool budget is **4,400 Ommm**. The Voice contract's `weeklyBudget` is **10,000 Ommm**, and the initial Ommm Voice minter budget covers one scheduled week. Additional weeks require enough remaining pool budget to reserve each week's allocation; an empty week carries its unminted allocation forward.
- The Base-fork rehearsal required 0.44 USDC for the first 4,400-Ommm learning pool and 0.856 USDC to open the initial 10,000-Ommm Voice budget at the permitted 10% price floor. These are rehearsal amounts, not a deployment or funding transaction; future Voice top-ups depend on the then-current reserve and committed supply.
- The user accepts that each pool's maximum 10% price decrease compounds: two pools each opening at the full limit can leave price at 81% of its prior level. Sponsor `fund` deposits raise it again.
- DLang learning uses `DLangOmmmLearningPool` to enforce one 0.1-Ommm reward per completed UTC day and sequential 1-Ommm levels 1–6. The steward attests that learning occurred; the contract enforces timing, sequence, and one-time awards, not the off-chain learning itself.
- DecentBusking's existing ArtFi settlement router supports generic approved ERC-20 deposits and payouts. The selected path is an Ommm pool-to-router adapter that funds allowlisted Busking payroll funds, preserving the router's payroll roles, contributor approvals, and work-reference idempotency. Adapter source and tests are in ArtFi #65; the adapter is not deployed and the router has not approved Ommm yet. The Busking UI still needs Ommm asset support after deployment and approval of the exact Ommm address. No Busking Ommm budget has been selected.

## Tests

`cd contract-tools && npm test`

`npm run test:ommm-base-fork` additionally rehearses the shared token, both DLang pools, and the existing DLang client against a local Base fork. It only reads remote Base and mutates the local fork.
