// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IDLangRewardToken {
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IDLangMilestoneMinter {
    function mintMilestone(address to, bytes32 awardId, bytes32 recordId, string calldata metadataURI) external returns (uint256);
}

contract DLangNarrationRewards {
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant REVIEW_TYPEHASH = keccak256("NarrationReview(bytes32 narrationId,bytes32 versionHash,bytes32 languageHash,address reviewer,bool approve,uint256 deadline)");
    bytes32 private constant CLAIM_TYPEHASH = keccak256("RewardClaim(address steward,bytes32 recordId,bytes32 awardId,bytes32 claimId,uint256 ommmUnits,string metadataURI,uint256 deadline)");
    bytes32 private constant NAME_HASH = keccak256("DLangNarrationRewards");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 private constant SECP256K1N_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct Narration {
        address author;
        bytes32 versionHash;
        bytes32 languageHash;
        bytes32 audioHash;
        bytes32 sceneHash;
        address[3] panel;
        uint8 approvals;
        uint8 rejections;
        bool exists;
        bool decided;
        bool active;
    }

    struct Vote {
        bytes32 narrationId;
        bytes32 versionHash;
        bytes32 languageHash;
        address reviewer;
        bool approve;
        uint256 deadline;
    }

    struct RewardClaim {
        address steward;
        bytes32 recordId;
        bytes32 awardId;
        bytes32 claimId;
        uint256 ommmUnits;
        string metadataURI;
        uint256 deadline;
    }

    address public immutable admin;
    address public immutable awardSigner;
    address public immutable ommm;
    address public immutable milestoneMinter;
    uint256 public immutable expectedChainId;
    bool private entered;

    mapping(bytes32 => mapping(address => bool)) public qualifiedNativeReviewer;
    mapping(bytes32 => Narration) private narrations;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    mapping(bytes32 => mapping(address => bool)) public voteRevoked;
    mapping(bytes32 => mapping(address => bool)) public voteChoice;
    mapping(bytes32 => bool) public usedClaimId;
    mapping(address => mapping(bytes32 => bool)) public claimedAward;

    event ReviewerQualificationUpdated(bytes32 indexed languageHash, address indexed reviewer, bool qualified);
    event NarrationRegistered(bytes32 indexed narrationId, address indexed author, bytes32 versionHash, bytes32 languageHash, bytes32 audioHash, bytes32 sceneHash);
    event ReviewerReplaced(bytes32 indexed narrationId, address indexed previousReviewer, address indexed replacementReviewer, bytes32 reasonHash);
    event ReviewVoteRecorded(bytes32 indexed narrationId, address indexed reviewer, bool approved, bytes32 versionHash);
    event ReviewVoteRevoked(bytes32 indexed narrationId, address indexed reviewer, bytes32 reasonHash);
    event NarrationDecision(bytes32 indexed narrationId, bool active, uint8 approvals, uint8 rejections);
    event RewardClaimed(bytes32 indexed claimId, address indexed steward, bytes32 indexed recordId, bytes32 awardId, uint256 ommmUnits, string metadataURI);

    error Unauthorized();
    error InvalidNarration();
    error InvalidPanel();
    error InvalidReviewer();
    error InvalidVote();
    error DuplicateVote();
    error InvalidSignature();
    error Expired();
    error InvalidClaim();
    error AlreadyClaimed();
    error WrongChain();
    error AssetUnavailable();
    error TransferFailed();
    error ReentrantCall();

    constructor(address administrator, address signer, address ommmToken, address milestoneContract, uint256 chainId) {
        if (administrator == address(0) || signer == address(0) || chainId == 0) revert Unauthorized();
        admin = administrator;
        awardSigner = signer;
        ommm = ommmToken;
        milestoneMinter = milestoneContract;
        expectedChainId = chainId;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    function setReviewerQualification(bytes32 languageHash, address reviewer, bool qualified) external {
        if (msg.sender != admin) revert Unauthorized();
        if (languageHash == bytes32(0) || reviewer == address(0)) revert InvalidReviewer();
        qualifiedNativeReviewer[languageHash][reviewer] = qualified;
        emit ReviewerQualificationUpdated(languageHash, reviewer, qualified);
    }

    function registerNarration(
        bytes32 narrationId,
        bytes32 versionHash,
        bytes32 languageHash,
        bytes32 audioHash,
        bytes32 sceneHash,
        address[3] calldata panel
    ) external {
        if (narrationId == bytes32(0) || versionHash == bytes32(0) || languageHash == bytes32(0)
            || audioHash == bytes32(0) || sceneHash == bytes32(0) || narrations[narrationId].exists) revert InvalidNarration();
        for (uint256 i; i < 3; ++i) {
            address reviewer = panel[i];
            if (reviewer == address(0) || reviewer == msg.sender || !qualifiedNativeReviewer[languageHash][reviewer]) revert InvalidPanel();
            for (uint256 j; j < i; ++j) if (panel[j] == reviewer) revert InvalidPanel();
        }
        Narration storage item = narrations[narrationId];
        item.author = msg.sender;
        item.versionHash = versionHash;
        item.languageHash = languageHash;
        item.audioHash = audioHash;
        item.sceneHash = sceneHash;
        item.panel = panel;
        item.exists = true;
        emit NarrationRegistered(narrationId, msg.sender, versionHash, languageHash, audioHash, sceneHash);
    }

    function replaceReviewer(bytes32 narrationId, address previousReviewer, address replacementReviewer, bytes32 reasonHash) external {
        if (msg.sender != admin) revert Unauthorized();
        Narration storage item = narrations[narrationId];
        if (!item.exists || item.decided || previousReviewer == address(0) || replacementReviewer == address(0)
            || reasonHash == bytes32(0) || !qualifiedNativeReviewer[item.languageHash][replacementReviewer]
            || replacementReviewer == item.author) revert InvalidPanel();
        uint256 slot = 3;
        for (uint256 i; i < 3; ++i) {
            if (item.panel[i] == previousReviewer) slot = i;
            if (item.panel[i] == replacementReviewer) revert InvalidPanel();
        }
        if (slot == 3 || (hasVoted[narrationId][previousReviewer] && !voteRevoked[narrationId][previousReviewer])) revert InvalidReviewer();
        item.panel[slot] = replacementReviewer;
        emit ReviewerReplaced(narrationId, previousReviewer, replacementReviewer, reasonHash);
    }

    function submitReview(Vote calldata vote, bytes calldata signature) external {
        Narration storage item = narrations[vote.narrationId];
        if (!item.exists || item.decided || vote.versionHash != item.versionHash || vote.languageHash != item.languageHash
            || vote.reviewer == address(0) || block.timestamp > vote.deadline
            || !qualifiedNativeReviewer[item.languageHash][vote.reviewer]) revert InvalidVote();
        bool assigned;
        for (uint256 i; i < 3; ++i) if (item.panel[i] == vote.reviewer) assigned = true;
        if (!assigned || vote.reviewer == item.author) revert InvalidReviewer();
        if (hasVoted[vote.narrationId][vote.reviewer]) revert DuplicateVote();
        bytes32 structHash = keccak256(abi.encode(REVIEW_TYPEHASH, vote.narrationId, vote.versionHash, vote.languageHash, vote.reviewer, vote.approve, vote.deadline));
        if (_recover(_typedDataHash(structHash), signature) != vote.reviewer) revert InvalidSignature();
        hasVoted[vote.narrationId][vote.reviewer] = true;
        voteChoice[vote.narrationId][vote.reviewer] = vote.approve;
        if (vote.approve) item.approvals++;
        else item.rejections++;
        emit ReviewVoteRecorded(vote.narrationId, vote.reviewer, vote.approve, vote.versionHash);
        if (item.approvals >= 2 || item.rejections >= 2) {
            item.decided = true;
            item.active = item.approvals >= 2;
            emit NarrationDecision(vote.narrationId, item.active, item.approvals, item.rejections);
        }
    }

    function revokeReviewVote(bytes32 narrationId, address reviewer, bytes32 reasonHash) external {
        if (msg.sender != admin) revert Unauthorized();
        Narration storage item = narrations[narrationId];
        if (!item.exists || !hasVoted[narrationId][reviewer] || voteRevoked[narrationId][reviewer] || reasonHash == bytes32(0)) revert InvalidVote();
        voteRevoked[narrationId][reviewer] = true;
        if (voteChoice[narrationId][reviewer]) item.approvals--;
        else item.rejections--;
        if (item.decided) {
            item.decided = false;
            item.active = false;
            emit NarrationDecision(narrationId, false, item.approvals, item.rejections);
        }
        emit ReviewVoteRevoked(narrationId, reviewer, reasonHash);
    }

    function isNarrationActive(bytes32 narrationId) external view returns (bool) {
        return narrations[narrationId].active;
    }

    function narrationSummary(bytes32 narrationId) external view returns (
        address author, bytes32 versionHash, bytes32 languageHash, bytes32 audioHash, bytes32 sceneHash,
        address[3] memory panel, uint8 approvals, uint8 rejections, bool decided, bool active
    ) {
        Narration storage item = narrations[narrationId];
        return (item.author, item.versionHash, item.languageHash, item.audioHash, item.sceneHash,
            item.panel, item.approvals, item.rejections, item.decided, item.active);
    }

    function claim(RewardClaim calldata reward, bytes calldata signature) external nonReentrant {
        if (block.chainid != expectedChainId) revert WrongChain();
        if (reward.steward == address(0) || reward.recordId == bytes32(0) || reward.claimId == bytes32(0)
            || (reward.awardId == bytes32(0) && reward.ommmUnits == 0)
            || (reward.awardId != bytes32(0) && bytes(reward.metadataURI).length == 0)) revert InvalidClaim();
        if (block.timestamp > reward.deadline) revert Expired();
        if (usedClaimId[reward.claimId] || (reward.awardId != bytes32(0) && claimedAward[reward.steward][reward.awardId])) revert AlreadyClaimed();
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, reward.steward, reward.recordId, reward.awardId,
            reward.claimId, reward.ommmUnits, keccak256(bytes(reward.metadataURI)), reward.deadline));
        if (_recover(_typedDataHash(structHash), signature) != awardSigner) revert InvalidSignature();
        if (reward.ommmUnits > 0 && (ommm.code.length == 0 || ommm == address(0))) revert AssetUnavailable();
        if (reward.awardId != bytes32(0) && (milestoneMinter.code.length == 0 || milestoneMinter == address(0))) revert AssetUnavailable();
        usedClaimId[reward.claimId] = true;
        if (reward.awardId != bytes32(0)) {
            claimedAward[reward.steward][reward.awardId] = true;
        }
        if (reward.ommmUnits > 0 && !IDLangRewardToken(ommm).transfer(reward.steward, reward.ommmUnits)) revert TransferFailed();
        if (reward.awardId != bytes32(0)) IDLangMilestoneMinter(milestoneMinter).mintMilestone(reward.steward, reward.awardId, reward.recordId, reward.metadataURI);
        emit RewardClaimed(reward.claimId, reward.steward, reward.recordId, reward.awardId, reward.ommmUnits, reward.metadataURI);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _typedDataHash(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > SECP256K1N_HALF || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
