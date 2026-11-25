# Ommm v1: one shared token, many reward pools

Prototype for [#9](https://github.com/TheJollyLaMa/DLang/issues/9). Not deployed.

Base currently has three separate Ommm tokens (`OmmmReserve`, `OmmmStaircase`, `OmmmVoicePilot`). `contracts/dlang/Ommm.sol` replaces them with one Ommm for DLang and the other Decent apps.

## How it works

- **USDC-backed.** Any holder can `redeem` Ommm for its share of the USDC reserve. Anyone can `fund` the reserve, which raises the price.
- **Pools instead of new tokens.** The owner opens a pool (a wallet or contract, such as DLang learning, DLang voice or DecentBusking) with an Ommm budget. The pool calls `reward(recipient, units, evidence)` to mint up to that budget. Each evidence hash can be used only once.
- **Price = reserve ÷ committed supply.** Committed supply is Ommm already minted plus every pool's unminted budget, so paying a reward never changes the price.
- **Funding rule.** Opening a pool, or adding budget, must deposit enough USDC that the price falls by no more than `maxDropBps`. That limit is 10% by default and can be lowered by the owner, never raised above 10%. `requiredAssets(budget)` shows the deposit needed. The very first pool is priced at the fixed `INITIAL_PRICE` ($0.0001 per whole Ommm).
- **Closing a pool** releases its unminted budget. Its USDC stays in the reserve, so the price rises.
- **Limits.** The owner sets a total supply cap (never below committed supply), can pause rewards, and blocks transfers into the contract.
- **Prototype recovery** follows the DecentAgency rule for contracts that hold funds: the owner can recover all backing, which retires the token, until `disablePrototypeRecovery` is called.

## Configuration before deployment

- The starting price is fixed to the original DLang price: $0.0001 per Ommm (`100` USDC base units per whole Ommm).
- `supplyCap` and the first pool budgets still need values before deployment.
- The user accepts that each pool's maximum 10% price decrease compounds: two pools each opening at the full limit can leave price at 81% of its prior level. Sponsor `fund` deposits raise it again.
- DLang learning uses `DLangOmmmLearningPool` to enforce one 0.1-Ommm reward per completed UTC day and sequential 1-Ommm levels 1–6. The steward attests that learning occurred; the contract enforces timing, sequence, and one-time awards, not the off-chain learning itself.

## Tests

`cd contract-tools && node --test ommm-v1.test.mjs dlang-ommm-learning-pool.test.mjs`
