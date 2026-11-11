# First pilot: reviewed intent, deployment not complete

- Network: Base mainnet, chain ID 8453.
- Asset: Circle native USDC, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
  Public Base RPC checks confirmed nonempty code, symbol USDC and six decimals.
  Official address reference: https://developers.circle.com/stablecoins/usdc-contract-addresses
- Steward: `decentagency.eth`, resolved independently through Ethereum PublicNode
  and dRPC on November 10, 2026 to
  `0xcAeEd8422fB5682C298B7F0971906d446fFd4e7a`, explicitly confirmed by steward.
- Roster: five reviewed addresses in `public/dlang/pilot-roster.json`; an eight-member
  maximum, not a promise of eight confirmed testers. Three existing public Busking
  accounts plus explicitly requested GrannyLyn and Bobdub. No private registries.
- Buy-in intent: 1 USDC. Scores reviewed by steward; 76/84 qualifies; 48-hour
  review/dispute interval. Qualifiers recover principal plus equal forfeitures
  and carry; no winner means carryover.
- Recovery: before settlement admin may cancel/refund; shutdown returns unawarded
  carry to original contributors. Admin may trigger owner-only claims, never sweep.
  Fixed roster, 14-day recovery timeout and proportional sub-unit dust attribution
  with roster-order ties were explicitly approved for this trial.
- Deployment gas cap: 0.001 ETH total maximum, not a quoted estimate or permission
  to silently exceed it.
- Schedule: first local learning pilot November 16, 2026 09:00 through Sunday
  November 22 18:00 America/New_York. Daily scenes Tue-Sun open at midnight.
  Each actual on-chain round needs reviewed matching timestamps/terms.

## Deployment completed; real buy-ins still blocked

The empty Base escrow is `0xD0F666DF2dD23437F5e4d7eB975295b5885ee15E`.
Its deployment was signed by the approved steward wallet November 11 and cost
0.000013675070117090 ETH including L1 fees, within the 0.001 ETH cap. No token
approval, deposit, settlement or round opening was signed.
[Receipt and exact-source verification](../public/dlang/deployment.json).

Before a live-money launch:

1. Reviewed frontend approval/join/claim/admin proposal/cancellation flows,
   with wallet/network/code/receipt checks. Current frontend has none enabled.
2. An operator protocol for gathering/reviewing results, disputes and refunds.
   Local editable browser scores are not an automatic settlement oracle.
3. Language/content review and actual participant/device trial; a published
   frontend is not completion of these gates.
4. Explicit token pause/blacklist/upgrade risk disclosure and participant consent.

Native-USDC compatibility passed on local forks at Base blocks 55819909 and
55824746 (entry, settlement, owner claim and shutdown refund). All fork writes
stayed local. Deployment runtime/source, immutable steward/token and roster were
verified; these checks do not replace the remaining operational gates.

Do not announce a funded round merely because the preview countdown is running.
