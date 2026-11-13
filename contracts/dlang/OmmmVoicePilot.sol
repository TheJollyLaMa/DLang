// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "./OmmmStaircase.sol";

/// @notice One separately backed week. Owner attests off-chain playback receipts.
contract OmmmVoicePilot is OmmmStaircase {
    uint256 public constant WEEK_START = 1794805200; // Nov 16 2026, 00:00 America/New_York
    uint256 public constant WEEK_END = 1795410000; // Nov 23 2026, 00:00 America/New_York
    uint256 public constant VOICE_SUPPLY = 10_000 ether;
    bool public settled;
    bytes32 public settlementEvidence;
    event VoiceAward(address indexed contributor, uint256 units, bytes32 indexed evidence);
    event VoiceWeekSettled(bytes32 indexed evidence, uint256 recipients, uint256 units);
    event VoiceWeekCarried(bytes32 indexed evidence, uint256 inventory);

    constructor(address usdc, address steward) OmmmStaircase(usdc, steward) {
        if (block.chainid != 8453 || usdc != 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) revert InvalidConfiguration();
        _burn(address(this), INITIAL_SUPPLY);
        _mint(address(this), VOICE_SUPPLY);
    }

    function bootstrapAssets() public pure override returns (uint256) { return ONE_DOLLAR; }
    function bootstrap() public override {
        if (block.timestamp >= WEEK_START || asset.balanceOf(address(this)) != 0) revert Unavailable();
        super.bootstrap();
    }
    function fund(uint256) external pure override { revert Unavailable(); }
    function fundAndMint(uint256, uint256) external pure override { revert Unavailable(); }
    function awardDay(address, uint256, bytes32) external pure override { revert InvalidAward(); }
    function awardLevel(address, uint8, bytes32) external pure override { revert InvalidAward(); }

    // Empty recipients carry inventory; they do not fabricate a successful payout.
    function settleVoiceWeek(address[] calldata recipients, uint256[] calldata units, bytes32 evidence)
        external onlyOwner active whenNotPaused nonReentrant
    {
        if (!funded || settled || block.timestamp < WEEK_END || evidence == bytes32(0)
            || recipients.length != units.length || recipients.length > 128) revert InvalidAward();
        uint256 total;
        address prior;
        for (uint256 i; i < recipients.length; i++) {
            if (recipients[i] <= prior || recipients[i] == address(this) || units[i] == 0) revert InvalidAward();
            prior = recipients[i];
            total += units[i];
        }
        if (recipients.length != 0 && total != VOICE_SUPPLY) revert InvalidAward();
        settled = true;
        settlementEvidence = evidence;
        if (recipients.length == 0) {
            emit VoiceWeekCarried(evidence, balanceOf(address(this)));
            return;
        }
        for (uint256 i; i < recipients.length; i++) {
            _transfer(address(this), recipients[i], units[i]);
            emit VoiceAward(recipients[i], units[i], evidence);
        }
        emit VoiceWeekSettled(evidence, recipients.length, total);
    }
}
