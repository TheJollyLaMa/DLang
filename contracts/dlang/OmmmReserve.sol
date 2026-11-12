// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract OmmmReserve is ERC20, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant INITIAL_SUPPLY = 4_400 ether;
    uint256 public constant INITIAL_ASSETS = 440_000;
    uint256 public constant DAY_REWARD = 0.1 ether;
    uint256 public constant LEVEL_REWARD = 1 ether;
    uint256 public constant ONE_DOLLAR = 1_000_000;
    IERC20 public immutable asset;
    uint256 public immutable firstDay;
    bool public funded;
    mapping(address => mapping(uint256 => bool)) public awardedDay;
    mapping(address => uint8) public awardedLevel;
    mapping(bytes32 => bool) public usedEvidence;

    event Funded(address indexed sponsor, uint256 assets);
    event BackedMint(uint256 units, uint256 assets);
    event LearningAward(address indexed steward, uint8 kind, uint256 period, uint256 units, bytes32 evidence);
    event Redeemed(address indexed steward, uint256 units, uint256 assets);

    error InvalidConfiguration();
    error Unavailable();
    error InvalidAmount();
    error InvalidAward();
    error InexactTransfer();
    error MinimumNotMet();
    error TargetNotReached();

    constructor(address usdc, address steward) ERC20("Ommm", "Ommm") Ownable(steward) {
        if (usdc.code.length == 0 || IERC20Metadata(usdc).decimals() != 6) revert InvalidConfiguration();
        asset = IERC20(usdc);
        firstDay = block.timestamp / 1 days;
        _mint(address(this), INITIAL_SUPPLY);
    }

    function reserveAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function bootstrap() external onlyOwner nonReentrant {
        if (funded) revert Unavailable();
        _collect(INITIAL_ASSETS);
        funded = true;
        emit Funded(msg.sender, INITIAL_ASSETS);
    }

    function fund(uint256 assets) external nonReentrant {
        if (!funded) revert Unavailable();
        if (assets == 0) revert InvalidAmount();
        _collect(assets);
        emit Funded(msg.sender, assets);
    }

    function previewRedeem(uint256 units) public view returns (uint256) {
        if (!funded || totalSupply() == 0 || units > totalSupply()) return 0;
        return Math.mulDiv(units, reserveAssets(), totalSupply());
    }

    function redeem(uint256 units, uint256 minimumAssets) external nonReentrant {
        if (!funded) revert Unavailable();
        if (units == 0 || minimumAssets == 0) revert InvalidAmount();
        uint256 assets = previewRedeem(units);
        if (assets < minimumAssets) revert MinimumNotMet();
        _burn(msg.sender, units);
        uint256 beforePool = reserveAssets();
        uint256 beforeRecipient = asset.balanceOf(msg.sender);
        asset.safeTransfer(msg.sender, assets);
        if (reserveAssets() != beforePool - assets || asset.balanceOf(msg.sender) != beforeRecipient + assets)
            revert InexactTransfer();
        emit Redeemed(msg.sender, units, assets);
    }

    function previewMint(uint256 units) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (!funded || units == 0) revert InvalidAmount();
        if (supply == 0) return Math.mulDiv(units, ONE_DOLLAR, 1 ether, Math.Rounding.Ceil);
        uint256 reserve = reserveAssets();
        if (reserve < Math.mulDiv(supply, ONE_DOLLAR, 1 ether, Math.Rounding.Ceil)) revert TargetNotReached();
        return Math.mulDiv(units, reserve, supply, Math.Rounding.Ceil);
    }

    function fundAndMint(uint256 units, uint256 maximumAssets) external onlyOwner whenNotPaused nonReentrant {
        uint256 assets = previewMint(units);
        if (assets > maximumAssets) revert MinimumNotMet();
        _collect(assets);
        _mint(address(this), units);
        emit BackedMint(units, assets);
    }

    function awardDay(address steward, uint256 day, bytes32 evidence) external onlyOwner whenNotPaused nonReentrant {
        if (day < firstDay || day >= block.timestamp / 1 days || awardedDay[steward][day]) revert InvalidAward();
        awardedDay[steward][day] = true;
        _award(steward, DAY_REWARD, evidence);
        emit LearningAward(steward, 0, day, DAY_REWARD, evidence);
    }

    function awardLevel(address steward, uint8 level, bytes32 evidence) external onlyOwner whenNotPaused nonReentrant {
        if (level == 0 || level > 6 || level != awardedLevel[steward] + 1) revert InvalidAward();
        awardedLevel[steward] = level;
        _award(steward, LEVEL_REWARD, evidence);
        emit LearningAward(steward, 1, level, LEVEL_REWARD, evidence);
    }

    function pauseAwards() external onlyOwner { _pause(); }
    function resumeAwards() external onlyOwner { _unpause(); }

    function _award(address steward, uint256 units, bytes32 evidence) private {
        if (!funded || steward == address(0) || steward == address(this) || evidence == bytes32(0) || usedEvidence[evidence])
            revert InvalidAward();
        usedEvidence[evidence] = true;
        _transfer(address(this), steward, units);
    }

    function _collect(uint256 assets) private {
        uint256 beforePool = reserveAssets();
        asset.safeTransferFrom(msg.sender, address(this), assets);
        if (reserveAssets() != beforePool + assets) revert InexactTransfer();
    }

    function _update(address from, address to, uint256 value) internal override {
        // Inventory is distributed only by reviewed awards, not public transfers into the pool.
        if (from != address(0) && to == address(this)) revert InvalidAmount();
        super._update(from, to, value);
    }
}
