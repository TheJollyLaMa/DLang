// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Bounded, steward-scored pilot. This is not a trustless learning oracle.
contract DLangTrial {
    uint256 public constant ENTRY = 1_000_000;
    uint256 public constant REVIEW = 48 hours;
    uint256 public constant REFUND_DELAY = 14 days;
    uint256 public constant MAX_MEMBERS = 8;
    address public immutable token;
    address public immutable steward;
    address[] public members;
    mapping(address => bool) public member;
    mapping(address => uint256) public credit;
    mapping(address => uint256) public carry;
    uint256 public liabilities;
    uint256 public carryTotal;
    bool public stopped;
    bool private entered;

    enum Phase { None, Open, Proposed, Settled, Cancelled }
    struct Round {
        uint64 start;
        uint64 end;
        uint64 proposedAt;
        Phase phase;
        bytes32 terms;
        bytes32 results;
        uint256 deposits;
    }
    uint256 public roundCount;
    uint256 public resolvedCount;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => bool)) public enrolled;
    mapping(uint256 => mapping(address => uint8)) public score;
    mapping(uint256 => mapping(address => bytes32)) public language;

    event RoundOpened(uint256 indexed id, uint64 start, uint64 end, bytes32 terms);
    event Joined(uint256 indexed id, address indexed account, bytes32 language);
    event ResultsProposed(uint256 indexed id, bytes32 results, uint64 finalizeAfter);
    event Settled(uint256 indexed id, uint256 qualifiers, uint256 carryRemaining);
    event Cancelled(uint256 indexed id);
    event Stopped();
    event Claimed(address indexed account, uint256 amount);

    modifier onlySteward() {
        require(msg.sender == steward, "Steward only");
        _;
    }
    modifier lock() {
        require(!entered, "Reentrant");
        entered = true;
        _;
        entered = false;
    }

    constructor(address asset, address administrator, address[] memory roster) {
        require(asset.code.length > 0 && administrator != address(0), "Invalid configuration");
        require(roster.length > 0 && roster.length <= MAX_MEMBERS, "Roster size");
        token = asset;
        steward = administrator;
        (bool ok, bytes memory data) = asset.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok && data.length == 32 && abi.decode(data, (uint256)) == 6, "Six decimals required");
        for (uint256 i; i < roster.length; i++) {
            address account = roster[i];
            require(account != address(0) && !member[account], "Invalid member");
            member[account] = true;
            members.push(account);
        }
    }

    function memberCount() external view returns (uint256) { return members.length; }

    function openRound(uint64 start, uint64 end, bytes32 terms) external onlySteward {
        require(!stopped && block.timestamp < start && start <= block.timestamp + 7 days && terms != bytes32(0), "Round unavailable");
        require(roundCount - resolvedCount < 3, "Too many unresolved weeks");
        require(end > start && end - start >= 6 days && end - start <= 7 days, "Week duration");
        if (roundCount != 0) {
            require(start >= rounds[roundCount].end, "Overlapping week");
        }
        roundCount++;
        rounds[roundCount] = Round(start, end, 0, Phase.Open, terms, bytes32(0), 0);
        emit RoundOpened(roundCount, start, end, terms);
    }

    function join(uint256 id, bytes32 chosenLanguage) external lock {
        Round storage r = rounds[id];
        require(!stopped && r.phase == Phase.Open, "Round unavailable");
        require(block.timestamp < r.start && chosenLanguage != bytes32(0), "Enrollment closed");
        require(member[msg.sender] && !enrolled[id][msg.sender], "Ineligible or duplicate");
        enrolled[id][msg.sender] = true;
        language[id][msg.sender] = chosenLanguage;
        r.deposits += ENTRY;
        liabilities += ENTRY;
        _collect(msg.sender, ENTRY);
        _solvent();
        emit Joined(id, msg.sender, chosenLanguage);
    }

    /// @dev Results are submitted for every fixed roster position, including zero for non-entrants.
    function propose(uint256 id, uint8[] calldata scores, bytes32 results) external onlySteward {
        Round storage r = rounds[id];
        require(!stopped && r.phase == Phase.Open, "Not open");
        require(block.timestamp >= r.end && block.timestamp + REVIEW < r.end + REFUND_DELAY, "Review window");
        require(results != bytes32(0) && scores.length == members.length, "Results required");
        for (uint256 i; i < members.length; i++) {
            require(scores[i] <= 84 && (enrolled[id][members[i]] || scores[i] == 0), "Invalid score");
            score[id][members[i]] = scores[i];
        }
        r.phase = Phase.Proposed;
        r.proposedAt = uint64(block.timestamp);
        r.results = results;
        emit ResultsProposed(id, results, uint64(block.timestamp + REVIEW));
    }

    function finalize(uint256 id) external lock {
        Round storage r = rounds[id];
        require(!stopped && id == resolvedCount + 1 && r.phase == Phase.Proposed, "Not next proposed");
        require(block.timestamp >= r.proposedAt + REVIEW && block.timestamp < r.end + REFUND_DELAY, "Review or timeout");
        uint256 qualifiers;
        uint256 pool = carryTotal;
        uint256[] memory origins = new uint256[](members.length);
        for (uint256 i; i < members.length; i++) {
            address account = members[i];
            origins[i] = carry[account];
            if (enrolled[id][account]) {
                if (score[id][account] >= 76) qualifiers++;
                else {
                    origins[i] += ENTRY;
                    pool += ENTRY;
                }
            }
        }
        r.phase = Phase.Settled;
        resolvedCount = id;
        if (qualifiers == 0) {
            for (uint256 i; i < members.length; i++) carry[members[i]] = origins[i];
            carryTotal = pool;
        } else {
            uint256 share = pool / qualifiers;
            uint256 dust = pool % qualifiers;
            uint256 attributed;
            for (uint256 i; i < members.length; i++) {
                address account = members[i];
                if (enrolled[id][account] && score[id][account] >= 76) credit[account] += ENTRY + share;
                // Preserve origin ownership for unawarded dust; roster order resolves sub-unit rounding.
                carry[account] = pool == 0 ? 0 : dust * origins[i] / pool;
                attributed += carry[account];
            }
            for (uint256 i; attributed < dust && i < members.length; i++) {
                if (origins[i] != 0) {
                    carry[members[i]]++;
                    attributed++;
                }
            }
            require(attributed == dust, "Dust accounting");
            carryTotal = dust;
        }
        _solvent();
        emit Settled(id, qualifiers, carryTotal);
    }

    function cancel(uint256 id) external onlySteward lock {
        _cancel(id);
    }

    /// @notice Anyone can force principal recovery if the steward never finishes review.
    function expire(uint256 id) external lock {
        require(rounds[id].end != 0 && block.timestamp >= rounds[id].end + REFUND_DELAY, "Not expired");
        _cancel(id);
    }

    function _cancel(uint256 id) private {
        Round storage r = rounds[id];
        require(id == resolvedCount + 1 && (r.phase == Phase.Open || r.phase == Phase.Proposed), "Not next cancellable");
        r.phase = Phase.Cancelled;
        resolvedCount = id;
        for (uint256 i; i < members.length; i++) {
            if (enrolled[id][members[i]]) credit[members[i]] += ENTRY;
        }
        emit Cancelled(id);
    }

    /// @notice Stops future rounds, cancels unresolved entries and refunds each carry origin.
    function stop() external onlySteward lock { _stop(); }

    function expireAndStop() external lock {
        require(roundCount != 0, "No rounds");
        uint256 referenceRound = resolvedCount < roundCount ? resolvedCount + 1 : roundCount;
        require(block.timestamp >= rounds[referenceRound].end + REFUND_DELAY, "Not expired");
        _stop();
    }

    function _stop() private {
        require(!stopped, "Already stopped");
        stopped = true;
        while (resolvedCount < roundCount) _cancel(resolvedCount + 1);
        for (uint256 i; i < members.length; i++) {
            address account = members[i];
            credit[account] += carry[account];
            carry[account] = 0;
        }
        carryTotal = 0;
        emit Stopped();
    }

    /// @notice Can be triggered by admin or anyone else, but funds go only to their owner.
    function claimFor(address account) external lock {
        uint256 amount = credit[account];
        require(amount != 0, "No credit");
        credit[account] = 0;
        liabilities -= amount;
        _send(account, amount);
        _solvent();
        emit Claimed(account, amount);
    }

    // Exact balance-delta checks adapted from DecentEscrowV1's PaymentAsset.
    function _balance(address account) private view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        require(ok && data.length == 32, "Invalid balance");
        return abi.decode(data, (uint256));
    }
    function _call(bytes memory data) private {
        (bool ok, bytes memory result) = token.call(data);
        require(ok && (result.length == 0 || (result.length == 32 && abi.decode(result, (bool)))), "Transfer failed");
    }
    function _collect(address payer, uint256 amount) private {
        uint256 held = _balance(address(this));
        uint256 prior = _balance(payer);
        _call(abi.encodeWithSignature("transferFrom(address,address,uint256)", payer, address(this), amount));
        require(_balance(address(this)) == held + amount && _balance(payer) + amount == prior, "Non-exact asset");
    }
    function _send(address account, uint256 amount) private {
        uint256 held = _balance(address(this));
        uint256 prior = _balance(account);
        _call(abi.encodeWithSignature("transfer(address,uint256)", account, amount));
        require(_balance(address(this)) + amount == held && _balance(account) == prior + amount, "Non-exact asset");
    }
    function _solvent() private view { require(_balance(address(this)) >= liabilities, "Insolvent"); }
}
