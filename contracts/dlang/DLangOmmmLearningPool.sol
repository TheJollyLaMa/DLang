// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IOmmmLearningRewards {
    function reward(address recipient, uint256 units, bytes32 evidence) external;
}

/// @notice Enforces DLang's day and level reward limits before forwarding rewards to shared Ommm.
/// The steward attests that learning occurred; the contract enforces schedule and duplicate limits.
contract DLangOmmmLearningPool is Ownable2Step, ReentrancyGuard {
    uint256 public constant DAY_REWARD = 0.1 ether;
    uint256 public constant LEVEL_REWARD = 1 ether;
    uint8 public constant MAX_LEVEL = 6;

    IOmmmLearningRewards public immutable ommm;
    uint256 public immutable firstDay;
    mapping(address => mapping(uint256 => bool)) public awardedDay;
    mapping(address => uint8) public awardedLevel;

    event LearningAward(address indexed learner, uint8 indexed kind, uint256 indexed period, bytes32 evidence);

    error InvalidConfiguration();
    error InvalidAward();

    constructor(address ommmToken, address steward) Ownable(steward) {
        if (ommmToken.code.length == 0 || steward == address(0)) revert InvalidConfiguration();
        ommm = IOmmmLearningRewards(ommmToken);
        firstDay = block.timestamp / 1 days;
    }

    /// @notice Steward attests a completed, previous UTC calendar day. Each day is rewarded once.
    function awardDay(address learner, uint256 day, bytes32 evidence) external onlyOwner nonReentrant {
        if (learner == address(0) || evidence == bytes32(0)
            || day < firstDay || day >= block.timestamp / 1 days || awardedDay[learner][day]) {
            revert InvalidAward();
        }
        awardedDay[learner][day] = true;
        ommm.reward(learner, DAY_REWARD, evidence);
        emit LearningAward(learner, 0, day, evidence);
    }

    /// @notice Steward attests a completed level in order; each learner can earn levels 1 through 6 once.
    function awardLevel(address learner, uint8 level, bytes32 evidence) external onlyOwner nonReentrant {
        if (learner == address(0) || evidence == bytes32(0) || level == 0 || level > MAX_LEVEL
            || level != awardedLevel[learner] + 1) {
            revert InvalidAward();
        }
        awardedLevel[learner] = level;
        ommm.reward(learner, LEVEL_REWARD, evidence);
        emit LearningAward(learner, 1, level, evidence);
    }
}
