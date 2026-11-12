// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Prototype successor; existing Ommm backing and balances do not migrate automatically.
contract OmmmStaircase is ERC20, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 public constant INITIAL_SUPPLY = 4_400 ether;
    uint256 public constant INITIAL_ASSETS = 440_000;
    uint256 public constant DAY_REWARD = 0.1 ether;
    uint256 public constant LEVEL_REWARD = 1 ether;
    uint256 public constant ONE_DOLLAR = 1_000_000;
    uint256 private constant MAGNITUDE = 1e36;
    IERC20 public immutable asset;
    uint256 public immutable firstDay;
    bool public funded;
    bool public prototypeRetired;
    bool public recoveryDisabled;
    uint256 public dividendLiabilities;
    uint256 public dividendPerUnit;
    uint256 public resetCount;
    uint256 public highestStep;
    mapping(address => int256) private dividendCorrection;
    mapping(address => uint256) public dividendsPaid;
    mapping(address => mapping(uint256 => bool)) public awardedDay;
    mapping(address => uint8) public awardedLevel;
    mapping(bytes32 => bool) public usedEvidence;

    event Funded(address indexed sponsor, uint256 assets);
    event BackedMint(uint256 units, uint256 assets);
    event LearningAward(address indexed steward, uint8 kind, uint256 period, uint256 units, bytes32 evidence);
    event Redeemed(address indexed steward, uint256 units, uint256 assets);
    event StepReached(uint256 previousStep, uint256 step);
    event DividendReset(uint256 indexed cycle, uint256 supply, uint256 allocated, uint256 retained);
    event DividendClaimed(address indexed holder, uint256 assets);
    event InventoryDividendWithdrawn(address indexed administrator, address indexed recipient, uint256 assets);
    event PrototypeRecovery(address indexed administrator, address indexed asset, address indexed recipient, uint256 assets);
    event RecoveryDisabled();

    error InvalidConfiguration();
    error Unavailable();
    error InvalidAmount();
    error InvalidAward();
    error InexactTransfer();
    error MinimumNotMet();
    error TargetNotReached();
    error ResetRequired();

    modifier active() {
        if (prototypeRetired) revert Unavailable();
        _;
    }

    constructor(address usdc, address steward) ERC20("Ommm", "Ommm") Ownable(steward) {
        if (usdc.code.length == 0 || IERC20Metadata(usdc).decimals() != 6) revert InvalidConfiguration();
        asset = IERC20(usdc);
        firstDay = block.timestamp / 1 days;
        _mint(address(this), INITIAL_SUPPLY);
    }

    function reserveAssets() public view returns (uint256) {
        if (prototypeRetired) return 0;
        return asset.balanceOf(address(this)) - dividendLiabilities;
    }

    function resetDue() public view returns (bool) {
        uint256 supply = totalSupply();
        return funded && supply != 0
            && reserveAssets() >= Math.mulDiv(supply, 2 * ONE_DOLLAR, 1 ether, Math.Rounding.Ceil)
            && reserveAssets() > Math.mulDiv(supply, ONE_DOLLAR, 1 ether, Math.Rounding.Ceil);
    }

    function currentStep() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (!funded || supply == 0) return 0;
        uint256 reserve = reserveAssets();
        uint256 step;
        for (uint256 value = 100; value <= ONE_DOLLAR; value *= 10) {
            if (reserve < Math.mulDiv(supply, value, 1 ether, Math.Rounding.Ceil)) break;
            step = value;
        }
        return step;
    }

    function bootstrap() external onlyOwner active nonReentrant {
        if (funded) revert Unavailable();
        _collect(INITIAL_ASSETS);
        funded = true;
        _checkpoint();
        emit Funded(msg.sender, INITIAL_ASSETS);
    }

    function fund(uint256 assets) external active nonReentrant {
        if (!funded) revert Unavailable();
        if (assets == 0) revert InvalidAmount();
        _collect(assets);
        _checkpoint();
        emit Funded(msg.sender, assets);
    }

    function checkpoint() external active nonReentrant {
        if (!funded) revert Unavailable();
        _checkpoint();
    }

    function _checkpoint() private {
        if (!funded) return;
        uint256 step = currentStep();
        if (step > highestStep) {
            emit StepReached(highestStep, step);
            highestStep = step;
        }
        if (!resetDue()) return;
        uint256 supply = totalSupply();
        uint256 retained = Math.mulDiv(supply, ONE_DOLLAR, 1 ether, Math.Rounding.Ceil);
        uint256 surplus = reserveAssets() - retained;
        dividendPerUnit += Math.mulDiv(surplus, MAGNITUDE, supply);
        // All allocated USDC, including fractional claim dust, stays outside redemption backing.
        dividendLiabilities += surplus;
        resetCount++;
        emit DividendReset(resetCount, supply, surplus, retained);
    }

    function accumulatedDividend(address holder) public view returns (uint256) {
        int256 scaled = (dividendPerUnit * balanceOf(holder)).toInt256() + dividendCorrection[holder];
        return SafeCast.toUint256(scaled) / MAGNITUDE;
    }

    function claimableDividend(address holder) public view returns (uint256) {
        if (prototypeRetired) return 0;
        return accumulatedDividend(holder) - dividendsPaid[holder];
    }

    function claimDividendFor(address holder) external active nonReentrant {
        if (holder == address(0) || holder == address(this)) revert InvalidAmount();
        _checkpoint();
        uint256 amount = _takeDividend(holder);
        _send(holder, amount);
        emit DividendClaimed(holder, amount);
    }

    function withdrawInventoryDividend(address recipient, uint256 assets) external onlyOwner active nonReentrant {
        if (recipient == address(0) || recipient == address(this) || assets == 0) revert InvalidAmount();
        _checkpoint();
        if (assets > claimableDividend(address(this))) revert InvalidAmount();
        dividendsPaid[address(this)] += assets;
        dividendLiabilities -= assets;
        _send(recipient, assets);
        emit InventoryDividendWithdrawn(msg.sender, recipient, assets);
    }

    function _takeDividend(address holder) private returns (uint256 amount) {
        amount = claimableDividend(holder);
        if (amount == 0) revert InvalidAmount();
        dividendsPaid[holder] += amount;
        dividendLiabilities -= amount;
    }

    function previewRedeem(uint256 units) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (!funded || supply == 0 || units > supply) return 0;
        uint256 reserve = resetDue()
            ? Math.mulDiv(supply, ONE_DOLLAR, 1 ether, Math.Rounding.Ceil) : reserveAssets();
        return Math.mulDiv(units, reserve, supply);
    }

    function redeem(uint256 units, uint256 minimumAssets) external active nonReentrant {
        if (!funded) revert Unavailable();
        if (units == 0 || minimumAssets == 0) revert InvalidAmount();
        _checkpoint();
        uint256 assets = previewRedeem(units);
        if (assets < minimumAssets) revert MinimumNotMet();
        _burn(msg.sender, units);
        _send(msg.sender, assets);
        emit Redeemed(msg.sender, units, assets);
    }

    function previewMint(uint256 units) public view returns (uint256) {
        if (prototypeRetired) revert Unavailable();
        if (!funded || units == 0) revert InvalidAmount();
        if (resetDue()) revert ResetRequired();
        uint256 supply = totalSupply();
        if (supply == 0) return Math.mulDiv(units, ONE_DOLLAR, 1 ether, Math.Rounding.Ceil);
        uint256 reserve = reserveAssets();
        if (reserve < Math.mulDiv(supply, ONE_DOLLAR, 1 ether, Math.Rounding.Ceil)) revert TargetNotReached();
        return Math.mulDiv(units, reserve, supply, Math.Rounding.Ceil);
    }

    function fundAndMint(uint256 units, uint256 maximumAssets) external onlyOwner whenNotPaused nonReentrant {
        uint256 assets = previewMint(units);
        if (assets > maximumAssets) revert MinimumNotMet();
        _checkpoint();
        _collect(assets);
        _mint(address(this), units);
        _checkpoint();
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

    // PROTOTYPING ONLY: the owner can recover even holder backing and dividend funds.
    // When ready for group custody, ask for a proper two-step ownership handoff if not
    // already completed, and explicitly decide whether to permanently disable recovery.
    // Retirement voids payouts; historical balances and dividend records are not erased.
    function recoverPrototype(address recoveryAsset, address recipient) external onlyOwner nonReentrant {
        if (recoveryDisabled || recipient == address(0) || recipient == address(this)) revert InvalidAmount();
        prototypeRetired = true;
        funded = false;
        uint256 amount = recoveryAsset == address(0)
            ? address(this).balance : IERC20(recoveryAsset).balanceOf(address(this));
        if (amount == 0) revert InvalidAmount();
        if (recoveryAsset == address(0)) {
            (bool ok,) = payable(recipient).call{value: amount}("");
            if (!ok) revert InexactTransfer();
        } else if (recoveryAsset == address(asset)) {
            _send(recipient, amount);
        } else {
            IERC20(recoveryAsset).safeTransfer(recipient, amount);
        }
        emit PrototypeRecovery(msg.sender, recoveryAsset, recipient, amount);
    }

    function disablePrototypeRecovery() external onlyOwner active {
        if (recoveryDisabled) revert Unavailable();
        recoveryDisabled = true;
        emit RecoveryDisabled();
    }

    receive() external payable {}

    function _award(address steward, uint256 units, bytes32 evidence) private {
        if (!funded || steward == address(0) || steward == address(this) || evidence == bytes32(0) || usedEvidence[evidence])
            revert InvalidAward();
        usedEvidence[evidence] = true;
        _transfer(address(this), steward, units);
    }

    function _collect(uint256 assets) private {
        uint256 held = asset.balanceOf(address(this));
        uint256 prior = asset.balanceOf(msg.sender);
        asset.safeTransferFrom(msg.sender, address(this), assets);
        if (asset.balanceOf(address(this)) != held + assets || asset.balanceOf(msg.sender) != prior - assets)
            revert InexactTransfer();
    }

    function _send(address recipient, uint256 assets) private {
        uint256 held = asset.balanceOf(address(this));
        uint256 prior = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, assets);
        if (asset.balanceOf(address(this)) != held - assets || asset.balanceOf(recipient) != prior + assets)
            revert InexactTransfer();
    }

    function _update(address from, address to, uint256 value) internal override {
        if (prototypeRetired) revert Unavailable();
        if (from != address(0) && to == address(this)) revert InvalidAmount();
        if (from != address(0)) _checkpoint();
        int256 correction = (dividendPerUnit * value).toInt256();
        if (from != address(0)) dividendCorrection[from] += correction;
        if (to != address(0)) dividendCorrection[to] -= correction;
        super._update(from, to, value);
    }
}
