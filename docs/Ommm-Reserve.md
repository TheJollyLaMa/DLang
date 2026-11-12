# Ommm on Base

The Base ERC-20 is also the reserve-pool token. It is not an AMM/LP token or a
bridge to Polygon Ommm. Deployment receipts, runtime hash and initial funding
are recorded in [the public manifest](../public/dlang/ommm-deployment.json).
Base contract: `0xD5062a20A9eC942322fb63407DC5B327cF9AA8b6`.
The 4,400-token supply and 0.44 USDC reserve were confirmed November 12, 2026.
Deployment, exact approval and bootstrap cost 0.000011887132091035 ETH in total.

The [staircase successors](Ommm-Staircase.md) add dividend resets and a new weekly
50/50 forfeiture split. They are deployed as separate prototypes with fresh
funding and full administrator recovery; no paid round is open. They do not
change any rules or balances described below for the live original pool.

## Rules

- 4,400 Ommm, 18 decimals, initially held as reward inventory by the contract.
  Bootstrap funding is exactly 0.44 native Base USDC (440,000 six-decimal units).
- Backing = actual reserve USDC / **all outstanding Ommm**, including inventory.
  Initially 0.0001 USDC per Ommm. With unchanged supply, 4,399.56 additional USDC
  would bring backing to 1 USDC each. That is a funding target, not a market peg.
- Sponsors can call `fund` with exact approval or send Base USDC directly to the
  contract. Both increase every token's backing. Never send ETH or Ommm.
- Trial awards transfer existing inventory: 0.1 Ommm per completed three-session
  UTC practice day and 1 Ommm per completed curriculum level, sequentially 1-6.
  Completed days must be on/after deployment. Owner review of learning evidence
  is required; local progress does not authorize an award. Wallet/period and
  evidence-hash replay protection apply. This is not a trustless learning oracle;
  the owner can approve dishonest evidence or additional identities.
- Holders redeem by burning Ommm for `floor(units * reserve / totalSupply)`.
  The recipient is always the caller. A positive minimum USDC amount is required;
  zero-value dust reverts, leaving tokens intact for batching. No platform fee.
  Wallet network gas is separate and may exceed a tiny redemption's value.
- Future minting is owner-only and unavailable below 1 USDC backing per token.
  Once reached, each mint deposits **rounded-up current backing** for all new
  tokens, atomically, into the same reserve. It cannot dilute existing backing.
  Newly minted tokens enter reward inventory, not the owner's wallet. Usage data
  informs future decisions; no usage-triggered mint or extra spending is enabled.
- No admin reserve withdrawal, inventory redemption, upgrade proxy or rescue
  path. Two-step owner transfer; pausing stops awards/minting but never holder
  transfers/redemption. USDC's own issuer pause/blacklist and depeg risks remain.
- Weekly entry/refund/winnings liabilities and narration playback obligations
  are **not** funded by or credited against this reserve.

## Operator

`contract-tools/deploy-ommm.mjs --env <authorized-file> --step <operation>`
defaults to unsigned simulation/preflight. Inspect its report, then repeat with
`--broadcast` within ten minutes. Deployment operations are `deploy`, `approve`,
`bootstrap`, in that order. Approval is exactly 0.44 USDC and is consumed fully.
The script checks Base, `decentagency.eth`, the approved signer, runtime, nonces
and cumulative 0.001 ETH launch-gas ceiling including Base L1 fees.

Reviewed awards use `--step day|level --recipient <wallet> --period <YYYY-MM-DD|1-6>
--evidence <0x32-byte-hash>` with the same unsigned-then-broadcast workflow.
Hash a distinct privacy-safe reviewed award record, including recipient, kind,
period and evidence reference; do not reuse an export hash for multiple awards.
No award is automatically approved or broadcast by the app.

Ignored local journals under `contract-tools/build/ommm/` record the signed hash
before broadcast. Pending, ambiguous or already-submitted operations stop rather
than retry. Keep these records: deleting them does not reset a chain nonce.
The browser similarly keeps an unresolved redemption intent in session storage.
Resolve an ambiguous wallet submission against wallet history/chain receipts
before manually clearing it; never assume a transport error means no transaction.

## Reuse and verification

The curated Canopy map and local Market/Agency/QuickLiquidityChecker sources,
deployment records and relevant worktrees were inspected. Market's
`RightAnkhDropdown.js` at `c8fc6ded02443f998726c8cd47e12b47d6cecbc8` establishes
the Polygon reference only. Original Ommm source was unavailable in that scope
and Sourcify had no match; the Polygon explorer API was inaccessible. We did not
copy an unverified token implementation.

Build-new reserve policy uses MIT-licensed OpenZeppelin 5.6.1 ERC20, SafeERC20,
Math, ReentrancyGuard and Ownable2Step. This follows the safe token-transfer
pattern in VoyagerRewards at `87c5e92d79701d8ffba7e645e2e7445119050c39` but
deliberately excludes its admin asset-release escape hatches. The receiving
reserve must never expose one for its backing.

Validation: deterministic local reserve tests; browser quote, wallet-switch,
receipt, replay and reduced-motion tests; existing app/contract regressions.
`node --test contract-tools/ommm-base-fork.test.mjs` additionally verifies actual
Base USDC bootstrap, reviewed award, browser client runtime checks and burn
redemption on a **local-only** fork. No test awards are sent to mainnet.
This bounded review/testing is not an independent security audit.
