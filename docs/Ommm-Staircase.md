# Staircase successors: built, not deployed

These are **new, locally tested contracts**, not changes to the live reserve:

- [OmmmStaircase](../contracts/dlang/OmmmStaircase.sol): reserve-backed Ommm,
  milestones, dividend resets and separately accounted claims.
- [DLangStaircaseTrial](../contracts/dlang/DLangStaircaseTrial.sol): the weekly
  pilot with a 50/50 split of finalized forfeitures.

No signing, deployment, additional funding, live configuration change or keeper
subscription is authorized for this version. The original deployed contracts,
their source, balances, claims and public deployment manifests remain unchanged.

## Staircase and reset

With the initial 4,400-token supply, the milestones are:

| Backing per Ommm | Required backing USDC |
|---:|---:|
| 0.0001 | 0.44 |
| 0.001 | 4.40 |
| 0.01 | 44 |
| 0.10 | 440 |
| 1 | 4,400 |
| 2: dividend reset | 8,800 |

Amounts are actual native Base USDC, never unpaid revenue or refundable stakes.
Backing remains continuous between milestones; these are not guaranteed market
prices. `currentStep()` and `highestStep()` use six-decimal USDC-per-token units:
100 means 0.0001 USDC. Events record new high-water milestones.

When net backing reaches at least 2 USDC per outstanding Ommm, the contract:

1. Retains `ceil(totalSupply * 1_000_000 / 1e18)` USDC micro-units for backing.
2. Allocates **all** surplus as dividends, including any overshoot.
3. Leaves every holder's token balance intact and records the reset event.

At unchanged supply, 8,800 USDC becomes 4,400 backing plus 4,400 dividend debt.
Unclaimed dividends are subtracted from `reserveAssets()`: they cannot be
redeemed, matched-minted against or allocated again in another reset.
Deposits after the reset start the next climb.

## Ownership and payouts

Dividends belong to the token balances at each checkpoint. A per-token
accumulator with signed account corrections preserves earned rights through
transfers and burns. Later awards and mints do not receive past dividends.
This is a checkpoint distribution, not a time-weighted holding reward.

- Anyone may call `claimDividendFor(holder)`; funds go only to that holder.
  Tokens are not burned. Claims accumulate until worth the holder's network gas.
- Holder redemption still burns tokens for their proportional **backing**, not
  dividend liabilities. Burning does not erase the holder's accrued dividend.
- Inventory's allocation is recorded separately as the contract's own dividend.
  For this test version, the owner may call
  `withdrawInventoryDividend(recipient, assets)` against **only that allocation**.
  The withdrawal records administrator, recipient and amount in an event.
  It cannot withdraw holder dividends or token backing.
- **This is an administrator trust surface**, explicitly requested for testing.
  Inventory dividends are not irrevocably locked for learning. Owner-controlled
  award approval/identities also remain trusted; editable practice data is not
  a learning oracle. Production treasury controls require a separate decision.

Dividend accounting uses 1e36 precision. Whole-micro-USDC claims round down;
fractional entitlements accumulate across resets. Allocation rounding dust stays
reserved, with no administrator sweep. Tiny-supply backing rounds up to avoid
underfunding; a zero-surplus rounding case does not create a reset.

Matched future issuance remains owner-only and unavailable below 1 USDC backing.
If a direct donation has made a reset due, minting stops until checkpointed.
Matching funds and new inventory are accounted together, so the mint deposit
cannot falsely trigger a dividend against the old supply. New units require
rounded-up current backing and do not dilute holders.

Pause applies only to awards and issuance. Checkpoints, funding, holder transfers,
claims, inventory-dividend withdrawals and redemption remain available. Native
USDC issuer controls (including blacklist/pause) and depeg risks still apply.

## Weekly forfeitures: half for each destination

The existing pilot qualification rule remains **76 of 84**, steward-reviewed
after the same 48-hour review window. A "dropped streak" here means a finalized
nonqualifying weekly result, not a browser clock or automatic midweek seizure.

For each finalized nonqualifier's 1 USDC:

- 0.50 USDC is allocated to the staircase.
- 0.50 USDC joins the survivor pot. Qualifiers recover their full 1 USDC principal
  plus an equal share of this pot and prior survivor carry.
- If nobody qualifies, the survivor half carries to the next settled week.
  It is never split a second time.
- Sub-micro-unit division dust retains origin attribution. On shutdown, survivor
  carry is returned to its recorded origins, as in the original pilot.
- Cancelled, timed-out and stopped unresolved entries refund **all principal**;
  they do not create forfeitures or staircase credits.

Example: three entrants, two qualifiers, one nonqualifier means 1.25 USDC credit
per qualifier and 0.50 USDC staircase credit. No qualifiers among three entrants
means 1.50 USDC to the staircase and 1.50 survivor carry.

Settlement creates `staircaseCredit` inside escrow liabilities, not reserve
backing. `fundStaircase()` is permissionless and can transfer it only to the
immutable, same-asset staircase. It moves the USDC and checkpoints the pool
atomically, then clears the debt. Failures revert the delivery without losing
credit. Settlement and participant claims do not call the pool, so pool outages
cannot trap their refunds. Staircase credit remains deliverable after shutdown.

## What is and is not automatic

- `fund` automatically checks milestones and performs a due reset.
- Token transfers, awards and burns checkpoint **before** changing ownership.
- Direct USDC transfers need a subsequent permissionless `checkpoint()` or token
  action to update dividend accounting.
- A weekly operator or keeper must submit finalization and `fundStaircase()`.
  The separate delivery transaction is deliberate failure isolation.
- Any relayer can sponsor holder claims, but cannot redirect their money.
- No holder-list iteration, wallet key in the frontend, background keeper,
  gas subsidy or third-party automation subscription is installed here.

On deployment, the operator must arrange and verify transaction execution;
contract eligibility checks alone do not schedule transactions.

## Migration and activation gates

The deployed reserve is non-upgradeable and cannot transfer its locked backing
into a successor. Deploying a new genesis creates another 4,400 tokens, **not**
a migration, bridge or automatic replacement for existing gems.

Before any chain writes:

1. Approve an explicit fresh-genesis or holder-led migration policy, including
   coexistence and treatment of old inventory. Preserve old balances and claims.
2. Approve any additional USDC funding and quote cumulative gas against the
   remaining original gas budget. This task approved **neither**.
3. Review the administrator inventory-dividend authority and owner destination.
4. Pin reviewed code/constructor/runtime hashes, fund and verify the new pool,
   then configure the new trial's immutable same-asset destination.
5. Add versioned successor deployment evidence, dividend/checkpoint transaction
   UI and verified automation. Do not silently point the existing notebook at
   a new contract: its current quote display has no dividend-claim controls.
6. Publish new weekly terms and obtain opt-in before opening successor rounds;
   never retroactively skim old escrow forfeitures or unresolved deposits.

No migration or successor deployment script is enabled by this change. The
existing deployment commands continue targeting their original contracts.

## Reuse and receiving tests

Adapted the actual `OmmmReserve` and `DLangTrial` sources at
`6067d3b3d4ca3b6613465bd1ef602d711bd4174f`, their exact-transfer helpers and
OpenZeppelin 5.6.1 primitives. Separate successor files intentionally preserve
the exact already-deployed source identities and constructor/settlement terms.
The existing compiler helper is shared, with explicit compilation targets.

The Canopy map and relevant Busking/Market source leads did not establish a
compatible dividend-reset implementation in the inspected scope. Busking's
public fund indexers are not writable reserve contracts. New accumulator and
split accounting are tested here rather than asserted to be an integration.

Validation:

```sh
npm run test:contracts
npm run test:staircase-fork --prefix contract-tools
node --test test/dlang-ommm.test.cjs
```

Tests cover exact milestone thresholds, overshoots, repeated resets, debt
segregation, recipient-bound claims, admin-only inventory withdrawals,
transfers/burns/mints, rounding and a multi-cycle independent balance model.
Weekly tests cover 50/50 conservation, no-survivor carry, eight-member accounting,
review gates, refunds and pool/asset delivery failures. The fork exercises the
full split-to-reset/claim/redemption flow against actual Base USDC on local
Ganache only. Original deployment bytecode is unchanged and successor full-source
compiler inputs reproduce deployable bytecode. These tests are not a formal audit.
