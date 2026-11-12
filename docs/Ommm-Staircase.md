# Staircase successors: deployed prototype

These are **new, deployed prototype contracts**, not changes to the original reserve:

- [OmmmStaircase](../contracts/dlang/OmmmStaircase.sol): reserve-backed Ommm,
  milestones, dividend resets and separately accounted claims.
- [DLangStaircaseTrial](../contracts/dlang/DLangStaircaseTrial.sol): the weekly
  pilot with a 50/50 split of finalized forfeitures.

The operator has authorized a fresh 0.44 USDC genesis and both successor
deployments, not a paid round. The original deployed contracts, their source,
balances, claims and public deployment manifests remain unchanged.

## Confirmed Base deployments

- Reserve: `0xFEEe3bEBa3e897f3db00D45CCF4Ed6927e0e301f`.
- Weekly successor: `0xf2a5f78c603026134D4455283E41A7ddd95FBefC`.
- Fresh genesis: 4,400 unawarded Ommm with 0.44 native Base USDC backing.
- No paid round opened; no old tokens, backing or claims migrated.
- Full prototype recovery remains enabled on both contracts.

[Versioned deployment evidence](../public/dlang/staircase-deployment.json)
records transaction receipts, source/runtime hashes and dated observations.
It is not a live synchronization feed. The original pool remains available
separately; the identical symbol does not make the two token addresses fungible.

## Prototype custody and full recovery

**These prototypes are administrator-custodied, not trustless savings accounts.**
The reserve owner and weekly steward can call `recoverPrototype(asset, recipient)`
to withdraw the entire balance of an ERC-20 or native ETH (`asset = address(0)`),
including token backing, earned dividends, entry principal and unpaid refunds.
This deliberately overrides the payout protections described below.

The first successful recovery permanently retires that contract. A retired
reserve reports `funded = false`, zero usable reserve and zero claimable
dividends; transfers, awards, funding, redemption and claims stop. A retired
weekly trial stops enrollment, settlement, delivery and refunds. Historical token
balances, rounds, credits and liabilities remain visible **as history, not payable
claims**. Recovery can subsequently retrieve mistaken deposits, but cannot
reactivate the prototype. Failed transfers roll back retirement atomically.

This authority is for prototyping only. When the stewards are ready to take
custody together, ask for a proper handoff if not already completed. Reserve
ownership uses OpenZeppelin's two-step nomination/acceptance; the weekly trial
uses `transferSteward`/`acceptSteward`. Neither silently removes recovery.
`disablePrototypeRecovery()` is a separate, irreversible administrator decision
available before retirement. Group custody does not automatically mean recovery
has been disabled; verify both contracts on-chain.

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
  This particular function cannot withdraw holder dividends or token backing;
  the separate full prototype recovery authority above can.
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

While active, pause applies only to awards and issuance. Checkpoints, funding, holder transfers,
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
2. Verify the approved additional 0.44 USDC funding and cumulative gas against the
   original 0.001 ETH ceiling. The ETH swap input cap is 0.00025 ETH, excluding
   gas, with 1% maximum input slippage for exactly 0.44 native Base USDC.
3. Review the administrator inventory-dividend authority and owner destination.
4. Pin reviewed code/constructor/runtime hashes, fund and verify the new pool,
   then configure the new trial's immutable same-asset destination.
5. Add versioned successor deployment evidence and dividend/checkpoint controls.
   The notebook now requires explicit pool selection and retains the original
   deployment. No external automation service is installed.
6. Publish new weekly terms and obtain opt-in before opening successor rounds;
   never retroactively skim old escrow forfeitures or unresolved deposits.

`contract-tools/staircase-launch.mjs` supports unsigned per-step preflights and
explicit broadcasts with durable transaction-hash journals. Never repeat a
submitted operation after an ambiguous response: reconcile its recorded hash.
The original deployment commands continue targeting their original contracts.

Run `node --test contract-tools/staircase-launch-fork.test.mjs` for a local-only
real Base USDC/Uniswap exact-output swap, fresh deployment, bootstrap and full
recovery test. No key is required and no remote transactions are sent.

## Future sponsor and subscription funding

Issues #4 and #5 remain deferred. Both can contribute **net, settled revenue**
through the existing permissionless `fund(assets)` path using native Base USDC;
this checkpoints milestones and dividend resets. Approve only the exact funding
amount, keep revenue provenance in their own ledgers and record the reserve's
`Funded` event. Neither adapter needs mint authority, recovery authority or a new
reserve implementation.

Do not treat refundable purchases, subscriptions, weekly principal or narrator
payment liabilities as surplus reserve funding. Conversion from other chains or
assets requires its own approved swap/bridge policy. No DVERT or subscription
adapter, standing allowance, budget, keeper or automatic revenue collection is
enabled by these contracts.

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
