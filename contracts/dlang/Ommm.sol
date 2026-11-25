// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice One shared Ommm for every Decent app. Each app pays rewards from a funded pool budget.
/// Price is reserve / committed supply, where committed supply also counts unminted pool budgets,
/// so rewards never move the price; only opening pool budget can, and only within maxDropBps.
contract Ommm is ERC20, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_DROP_BPS = 1_000;
    /// @notice 100 USDC base units (6 decimals) per whole Ommm, i.e. $0.0001.
    uint256 public constant INITIAL_PRICE = 100;

    struct Pool {
        uint256 budget;
        uint256 minted;
        bool open;
        string label;
    }

    IERC20 public immutable asset;
    uint256 public supplyCap;
    uint256 public maxDropBps = MAX_DROP_BPS;
    uint256 public outstandingBudget;
    bool public prototypeRetired;
    bool public recoveryDisabled;
    mapping(address => Pool) public pools;
    mapping(bytes32 => bool) public usedEvidence;

    event PoolOpened(address indexed minter, string label, uint256 addedBudget, uint256 assets);
    event PoolClosed(address indexed minter, uint256 releasedBudget);
    event Reward(address indexed minter, address indexed recipient, uint256 units, bytes32 indexed evidence);
    event Funded(address indexed sponsor, uint256 assets);
    event Redeemed(address indexed holder, uint256 units, uint256 assets);
    event SupplyCapChanged(uint256 cap);
    event MaxDropChanged(uint256 bps);
    event PrototypeRecovery(address indexed administrator, address indexed asset, address indexed recipient, uint256 assets);
    event RecoveryDisabled();

    error InvalidConfiguration();
    error Unavailable();
    error InvalidAmount();
    error InvalidReward();
    error NotPool();
    error CapExceeded();
    error MinimumNotMet();
    error InexactTransfer();

    modifier active() {
        if (prototypeRetired) revert Unavailable();
        _;
    }

    constructor(address usdc, address steward, uint256 cap) ERC20("Ommm", "Ommm") Ownable(steward) {
        if (usdc.code.length == 0 || IERC20Metadata(usdc).decimals() != 6 || cap == 0)
            revert InvalidConfiguration();
        asset = IERC20(usdc);
        supplyCap = cap;
    }

    function reserveAssets() public view returns (uint256) {
        return prototypeRetired ? 0 : asset.balanceOf(address(this));
    }

    function committedSupply() public view returns (uint256) {
        return totalSupply() + outstandingBudget;
    }

    function funded() external view returns (bool) {
        return committedSupply() != 0 && reserveAssets() != 0;
    }

    /// @notice USDC needed to add `budget` without dropping the price more than maxDropBps.
    function requiredAssets(uint256 budget) public view returns (uint256) {
        uint256 supply = committedSupply();
        if (supply == 0) return Math.mulDiv(budget, INITIAL_PRICE, 1 ether, Math.Rounding.Ceil);
        uint256 reserve = reserveAssets();
        uint256 floor = Math.mulDiv(reserve * (BPS - maxDropBps), supply + budget, supply * BPS, Math.Rounding.Ceil);
        return floor > reserve ? floor - reserve : 0;
    }

    /// @notice Opens a pool or adds budget to it. The caller deposits the required USDC.
    function openPool(address minter, string calldata label, uint256 budget, uint256 maximumAssets)
        external onlyOwner active nonReentrant
    {
        if (minter == address(0) || minter == address(this) || budget == 0) revert InvalidAmount();
        if (committedSupply() + budget > supplyCap) revert CapExceeded();
        uint256 assets = requiredAssets(budget);
        if (assets > maximumAssets) revert MinimumNotMet();
        if (assets != 0) _collect(assets);
        Pool storage pool = pools[minter];
        pool.budget += budget;
        pool.open = true;
        if (bytes(label).length != 0) pool.label = label;
        outstandingBudget += budget;
        emit PoolOpened(minter, pool.label, budget, assets);
    }

    /// @notice Releases a pool's unminted budget; the USDC stays and raises everyone's price.
    function closePool(address minter) external onlyOwner {
        Pool storage pool = pools[minter];
        if (!pool.open) revert NotPool();
        uint256 released = pool.budget - pool.minted;
        pool.open = false;
        pool.budget = pool.minted;
        outstandingBudget -= released;
        emit PoolClosed(minter, released);
    }

    function remainingBudget(address minter) external view returns (uint256) {
        Pool storage pool = pools[minter];
        return pool.open ? pool.budget - pool.minted : 0;
    }

    function reward(address recipient, uint256 units, bytes32 evidence) external active whenNotPaused nonReentrant {
        Pool storage pool = pools[msg.sender];
        if (!pool.open) revert NotPool();
        if (recipient == address(0) || recipient == address(this) || units == 0 || evidence == bytes32(0)
            || usedEvidence[evidence] || units > pool.budget - pool.minted) revert InvalidReward();
        usedEvidence[evidence] = true;
        pool.minted += units;
        outstandingBudget -= units;
        _mint(recipient, units);
        emit Reward(msg.sender, recipient, units, evidence);
    }

    function fund(uint256 assets) external active nonReentrant {
        if (assets == 0) revert InvalidAmount();
        _collect(assets);
        emit Funded(msg.sender, assets);
    }

    function previewRedeem(uint256 units) public view returns (uint256) {
        uint256 supply = committedSupply();
        if (units == 0 || supply == 0 || units > totalSupply()) return 0;
        return Math.mulDiv(units, reserveAssets(), supply);
    }

    function redeem(uint256 units, uint256 minimumAssets) external active nonReentrant {
        uint256 assets = previewRedeem(units);
        if (assets == 0 || assets < minimumAssets) revert MinimumNotMet();
        _burn(msg.sender, units);
        _send(msg.sender, assets);
        emit Redeemed(msg.sender, units, assets);
    }

    function setSupplyCap(uint256 cap) external onlyOwner {
        if (cap < committedSupply() || cap == 0) revert InvalidAmount();
        supplyCap = cap;
        emit SupplyCapChanged(cap);
    }

    function setMaxDropBps(uint256 bps) external onlyOwner {
        if (bps > MAX_DROP_BPS) revert InvalidAmount();
        maxDropBps = bps;
        emit MaxDropChanged(bps);
    }

    function pauseRewards() external onlyOwner { _pause(); }
    function resumeRewards() external onlyOwner { _unpause(); }

    // PROTOTYPING ONLY: the owner can recover all backing, which retires the token.
    // Before group custody, complete the two-step ownership handoff and explicitly decide
    // whether to call disablePrototypeRecovery.
    function recoverPrototype(address recoveryAsset, address recipient) external onlyOwner nonReentrant {
        if (recoveryDisabled || recipient == address(0) || recipient == address(this)) revert InvalidAmount();
        prototypeRetired = true;
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
        super._update(from, to, value);
    }
}
