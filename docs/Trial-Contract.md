# DLang trial escrow: source, not a deployed service

The steward requested a Base mainnet pilot using native USDC, a one-USDC entry,
up to eight trial members, steward-reviewed results and participant-only
recovery. This source is not an audit, deployed contract or permission to fund
the current browser preview. All frontend payments remain disabled.

## Trust and review

The fixed roster (at most eight wallets) and steward are immutable constructor
arguments. They must be explicitly reviewed before signing deployment. ENS is
resolved off-chain to an address; a later ENS change cannot change this contract.
The deployment must use Base native USDC, not merely any token reporting six
decimals. USDC pause, blacklist and upgrade powers remain external risks.

Scores are steward assertions: 0 through 84; 76 qualifies, 75 does not. Public
events record an evidence commitment, never raw personal stories. Review and
dispute resolution happen off-chain during the 48-hour interval. Results cannot
be overwritten: a material unresolved dispute requires cancellation/refund,
not silently changing the proposed scores. At the finalization boundary a
cancellation and finalization can race; the earlier mined transaction wins.
Local browser scores, profile links and allowlist display checks are not proof.

## Accounting and recovery

- One USDC means 1,000,000 base units; entrants also pay network gas.
- Qualified entrants recover principal plus equal shares of forfeitures and
  prior carryover. A round with no qualifiers adds all deposits to carryover.
- Division remainder stays in carryover. Its original-contributor ownership
  is allocated proportionally to that round's prize-pool contributions, with
  indivisible-unit ties resolved in fixed roster order. This can affect fewer
  than eight millionths of USDC, not a cent-based rounding system.
- Admin may cancel the next unresolved round before finalization. Each deposit
  becomes credit for its entrant, never admin money.
- Admin may stop the entire trial: every unresolved round is cancelled and all
  unawarded carry becomes credit for its original contributors. Already finalized
  winnings are final; paid funds cannot be clawed back.
- Anyone may call `claimFor(account)`, but the destination is always that account.
  Admin can pay a participant's refund gas without redirecting the refund.
- Fourteen days after the oldest unresolved round ends, anyone can force trial
  shutdown/refunds if the steward is absent. If every round is resolved, the same
  shutdown right opens fourteen days after the last round ends. This timeout is
  an additional proposed safety rule requiring launch approval.
- There is no sweep, upgrade, owner withdrawal or arbitrary destination. Direct
  unsolicited token transfers create no credit and cannot be recovered.

## Weekly overlap

The next Monday's enrollment can coexist with the preceding week's 48-hour
review. Carry is applied only in chronological settlement order; subsequent
settlement waits for prior resolution. At most three unresolved rounds may
exist, so shutdown loops stay bounded. A round may be opened at most seven days
in advance; there is no unlimited future schedule to defer recovery.

Exact New York Monday09:00/Sunday18:00 timestamps and content/language rules are
reviewed frontend/round-term configuration, not inferred by Solidity. The steward
must publish matching terms and confirm start/end before opening each round.
This contract does not certify daily activity or prevent cheating.

## Validation and reuse

Run `npm ci --ignore-scripts` and `npm test` in `contract-tools/`. Tests use local
Ganache and synthetic tokens only; they never send mainnet transactions.
Compilation pins solc 0.8.30, optimizer 200 runs, Shanghai EVM.

Exact balance-delta checks and optional-return ERC20 handling adapt
`contracts/default/PaymentAsset.sol` in DecentEscrow at
[`d130c53`](https://github.com/TheJollyLaMa/DecentEscrow/tree/d130c53c3b57af54af516dc0243b643e45ad8a45).
Apache-2.0 terms and repository LICENSE/NOTICE apply. Generic escrow
does not implement weekly forfeiture/carry provenance, so the bounded trial
ledger is new, not an extracted speculative shared engine. Focused reviews of
the initial draft and later weekly-overlap/recovery changes found no exploit.
Thirteen local contract tests pass. These bounded reviews are not independent
audits; no deployed/audited claim follows from them.

Before mainnet: approve fixed roster, exact admin/USDC addresses, timeout/dust
rules, bytecode/source verification, Base-USDC compatibility, gas estimate under
the 0.001 ETH cap, operator/dispute procedure and reviewed frontend transaction
flows. Signing requires an authorized wallet; never put a private key in source,
chat, browser profile or deployment metadata.
