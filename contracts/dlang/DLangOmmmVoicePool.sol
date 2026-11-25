// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IOmmmVoiceRewards {
    function remainingBudget(address minter) external view returns (uint256);
    function reward(address recipient, uint256 units, bytes32 evidence) external;
}

/// @notice Settles reviewed weekly voice allocations from the shared Ommm pool.
/// The steward attests playback receipts; this contract enforces window, budget, and idempotency rules.
contract DLangOmmmVoicePool is Ownable2Step, ReentrancyGuard {
    uint256 public constant MAX_RECIPIENTS = 128;
    uint256 public constant MAX_WEEK_DURATION = 8 days;

    struct Week {
        uint64 startAt;
        uint64 endAt;
        bytes32 evidence;
        bool scheduled;
        bool settled;
    }

    IOmmmVoiceRewards public immutable ommm;
    uint256 public immutable weeklyBudget;
    uint256 public reservedBudget;
    mapping(bytes32 => Week) public scheduledWeeks;

    event WeekScheduled(bytes32 indexed weekId, uint256 startAt, uint256 endAt, uint256 budget);
    event VoiceAward(bytes32 indexed weekId, address indexed contributor, uint256 units, bytes32 evidence);
    event VoiceWeekSettled(bytes32 indexed weekId, bytes32 indexed evidence, uint256 recipients, uint256 units);
    event VoiceWeekCarried(bytes32 indexed weekId, bytes32 indexed evidence, uint256 unspentUnits);

    error InvalidConfiguration();
    error InvalidWeek();
    error InvalidSettlement();
    error InsufficientOmmmBudget();

    constructor(address ommmToken, address steward, uint256 unitsPerWeek) Ownable(steward) {
        if (ommmToken.code.length == 0 || unitsPerWeek == 0) revert InvalidConfiguration();
        ommm = IOmmmVoiceRewards(ommmToken);
        weeklyBudget = unitsPerWeek;
    }

    /// @notice Schedule one New York-week allocation before its window closes.
    function scheduleWeek(bytes32 weekId, uint64 startAt, uint64 endAt) external onlyOwner {
        if (weekId == bytes32(0) || scheduledWeeks[weekId].scheduled || endAt <= block.timestamp
            || endAt <= startAt || uint256(endAt) - uint256(startAt) > MAX_WEEK_DURATION) {
            revert InvalidWeek();
        }
        uint256 available = ommm.remainingBudget(address(this));
        if (available < reservedBudget + weeklyBudget) revert InsufficientOmmmBudget();
        scheduledWeeks[weekId] = Week({startAt: startAt, endAt: endAt, evidence: bytes32(0), scheduled: true, settled: false});
        reservedBudget += weeklyBudget;
        emit WeekScheduled(weekId, startAt, endAt, weeklyBudget);
    }

    /// @notice Settle a reviewed allocation after the scheduled week ends. Empty lists carry the budget forward.
    function settleWeek(bytes32 weekId, address[] calldata recipients, uint256[] calldata units, bytes32 evidence)
        external onlyOwner nonReentrant
    {
        Week storage week = scheduledWeeks[weekId];
        if (!week.scheduled || week.settled || block.timestamp < week.endAt || evidence == bytes32(0)
            || recipients.length != units.length || recipients.length > MAX_RECIPIENTS) {
            revert InvalidSettlement();
        }

        uint256 total;
        address prior;
        for (uint256 i; i < recipients.length; i++) {
            if (recipients[i] == address(0) || recipients[i] == address(this) || recipients[i] <= prior || units[i] == 0) {
                revert InvalidSettlement();
            }
            prior = recipients[i];
            total += units[i];
        }
        if (recipients.length != 0 && total != weeklyBudget) revert InvalidSettlement();

        week.settled = true;
        week.evidence = evidence;
        reservedBudget -= weeklyBudget;

        if (recipients.length == 0) {
            emit VoiceWeekCarried(weekId, evidence, weeklyBudget);
            return;
        }

        for (uint256 i; i < recipients.length; i++) {
            bytes32 rewardEvidence = keccak256(abi.encode(address(this), weekId, evidence, recipients[i], units[i]));
            ommm.reward(recipients[i], units[i], rewardEvidence);
            emit VoiceAward(weekId, recipients[i], units[i], rewardEvidence);
        }
        emit VoiceWeekSettled(weekId, evidence, recipients.length, total);
    }
}
