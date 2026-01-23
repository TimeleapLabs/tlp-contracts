// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title TLPStaking
 * @notice Pool-based escrow contract for Timeleap compute providers
 * @dev All business logic (VM types, pricing, rentals) is handled off-chain.
 *      This contract is a simple escrow that:
 *      - Accepts user deposits (no signature required)
 *      - Executes withdrawals and claims with k-of-n EIP712 signatures
 *      - Maintains provider staking for accountability
 *      - Rental IDs are included in events for audit trail only (no on-chain state)
 */
contract TLPStaking is AccessControl, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ============ Roles ============
    bytes32 public constant POLICE_ROLE = keccak256("POLICE_ROLE");

    // ============ EIP712 Type Hashes ============
    bytes32 public constant WITHDRAWAL_TYPEHASH =
        keccak256("Withdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(bytes32 rentalId,address user,address provider,uint256 amount,uint256 nonce,uint256 deadline)");

    // ============ Custom Errors ============
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientStake();
    error StakeLocked();
    error AlreadyStaked();
    error ProviderBanned();
    error ProviderNotBanned();
    error NotAProvider();
    error InvalidDuration();
    error DurationTooShort();
    error InsufficientBalance();
    error InvalidSlashAmount();
    error SignerAlreadyAuthorized();
    error SignerNotAuthorized();
    error InsufficientSignatures();
    error DuplicateSignature();
    error InvalidSignature();
    error InvalidRequiredSignatures();
    error ArrayLengthMismatch();
    error CommissionTooHigh();
    error SignatureExpired();

    // ============ Events ============
    // Provider events
    event Staked(address indexed provider, uint256 amount, uint256 unlockTime);
    event StakeExtended(address indexed provider, uint256 newUnlockTime);
    event StakeIncreased(address indexed provider, uint256 addedAmount, uint256 newTotal, uint256 newUnlockTime);
    event StakeWithdrawn(address indexed provider, uint256 amount);
    event ProviderSlashed(address indexed provider, uint256 slashedStake, bool banned);
    event ProviderUnbanned(address indexed provider);

    // User balance events
    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);

    // Claim events (rentalId for audit trail)
    event Claimed(
        bytes32 indexed rentalId,
        address indexed user,
        address indexed provider,
        uint256 amount,
        uint256 commission
    );

    // Admin events
    event MinStakeDurationUpdated(uint256 oldDuration, uint256 newDuration);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event RequiredSignaturesUpdated(uint256 oldRequired, uint256 newRequired);
    event CommissionUpdated(uint256 oldCommission, uint256 newCommission);

    // ============ Structs ============
    struct ProviderInfo {
        uint256 stakeAmount;
        uint256 unlockTime;
        bool isBanned;
        uint256 slashCount;
    }

    struct ClaimRequest {
        bytes32 rentalId;
        address user;
        uint256 amount;
        uint256 deadline;
    }

    // ============ State Variables ============
    IERC20 public immutable tlpToken;
    address public treasury;

    uint256 public minStakeDuration = 30 days;
    uint256 public commissionBps; // Commission in basis points (10000 = 100%)

    // Provider staking
    mapping(address => ProviderInfo) public providers;

    // User balances in the pool
    mapping(address => uint256) public userBalances;

    // Single nonce per address for all operations
    mapping(address => uint256) public nonces;

    // Signer management
    mapping(address => bool) public isSigner;
    address[] public signers;
    uint256 public requiredSignatures;

    // ============ Constructor ============
    /**
     * @notice Initializes the staking contract
     * @param _tlpToken Address of the TLP token
     * @param _treasury Address where commission and slashed funds are sent
     * @param _admin Address that will have admin role
     */
    constructor(
        address _tlpToken,
        address _treasury,
        address _admin
    ) EIP712("TLPStaking", "1") {
        if (_tlpToken == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_admin == address(0)) revert ZeroAddress();

        tlpToken = IERC20(_tlpToken);
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(POLICE_ROLE, _admin);
    }

    // ============ User Balance Functions ============

    /**
     * @notice Deposit tokens to user's balance in the pool
     * @param amount Amount of tokens to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        userBalances[_msgSender()] += amount;
        tlpToken.safeTransferFrom(_msgSender(), address(this), amount);

        emit Deposited(_msgSender(), amount, userBalances[_msgSender()]);
    }

    /**
     * @notice Withdraw tokens from user's balance (requires k-of-n signatures)
     * @param amount Amount to withdraw
     * @param deadline Signature expiration timestamp
     * @param signatures Array of signatures from authorized signers
     */
    function withdraw(
        uint256 amount,
        uint256 deadline,
        bytes[] calldata signatures
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (amount > userBalances[_msgSender()]) revert InsufficientBalance();

        uint256 nonce = nonces[_msgSender()]++;

        _verifySignatures(
            _hashTypedDataV4(
                keccak256(abi.encode(WITHDRAWAL_TYPEHASH, _msgSender(), amount, nonce, deadline))
            ),
            signatures
        );

        userBalances[_msgSender()] -= amount;
        tlpToken.safeTransfer(_msgSender(), amount);

        emit Withdrawn(_msgSender(), amount, userBalances[_msgSender()]);
    }

    // ============ Provider Claim Functions ============

    /**
     * @notice Provider claims from a user's balance (requires k-of-n signatures)
     * @param rentalId Rental ID for audit trail (not stored on-chain)
     * @param user Address of the user to claim from
     * @param amount Amount to claim
     * @param deadline Signature expiration timestamp
     * @param signatures Array of signatures from authorized signers
     */
    function claim(
        bytes32 rentalId,
        address user,
        uint256 amount,
        uint256 deadline,
        bytes[] calldata signatures
    ) external nonReentrant {
        _verifyActiveProvider();

        (uint256 commission, uint256 providerAmount) = _processClaim(
            rentalId, user, amount, deadline, signatures
        );

        if (commission > 0) {
            tlpToken.safeTransfer(treasury, commission);
        }
        tlpToken.safeTransfer(_msgSender(), providerAmount);

        emit Claimed(rentalId, user, _msgSender(), amount, commission);
    }

    /**
     * @notice Provider claims from multiple users in a single transaction
     * @param claims Array of claim requests
     * @param signatures Array of signature arrays for each claim
     */
    function batchClaim(
        ClaimRequest[] calldata claims,
        bytes[][] calldata signatures
    ) external nonReentrant {
        uint256 length = claims.length;
        if (length != signatures.length) revert ArrayLengthMismatch();

        _verifyActiveProvider();

        uint256 totalAmount = 0;
        uint256 totalCommission = 0;
        uint256[] memory commissions = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            ClaimRequest calldata req = claims[i];
            (uint256 commission, uint256 providerAmount) = _processClaim(
                req.rentalId, req.user, req.amount, req.deadline, signatures[i]
            );
            commissions[i] = commission;
            totalCommission += commission;
            totalAmount += providerAmount;
        }

        if (totalCommission > 0) {
            tlpToken.safeTransfer(treasury, totalCommission);
        }
        if (totalAmount > 0) {
            tlpToken.safeTransfer(_msgSender(), totalAmount);
        }

        for (uint256 i = 0; i < length; i++) {
            ClaimRequest calldata req = claims[i];
            emit Claimed(req.rentalId, req.user, _msgSender(), req.amount, commissions[i]);
        }
    }

    // ============ Provider Staking Functions ============

    /**
     * @notice Stake tokens as a provider
     * @param amount Amount of tokens to stake
     * @param duration Duration to lock the stake (must be >= minStakeDuration)
     */
    function stake(uint256 amount, uint256 duration) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (duration < minStakeDuration) revert DurationTooShort();

        ProviderInfo storage provider = providers[_msgSender()];
        if (provider.isBanned) revert ProviderBanned();
        if (provider.stakeAmount > 0) revert AlreadyStaked();

        provider.stakeAmount = amount;
        provider.unlockTime = block.timestamp + duration;

        tlpToken.safeTransferFrom(_msgSender(), address(this), amount);

        emit Staked(_msgSender(), amount, provider.unlockTime);
    }

    /**
     * @notice Extend the lock duration of existing stake
     * @param newUnlockTime New unlock timestamp (must result in at least minStakeDuration from now)
     */
    function extendStakeDuration(uint256 newUnlockTime) external {
        ProviderInfo storage provider = providers[_msgSender()];
        if (provider.stakeAmount == 0) revert NotAProvider();
        if (provider.isBanned) revert ProviderBanned();

        uint256 minNewUnlock = block.timestamp + minStakeDuration;
        if (newUnlockTime < minNewUnlock) revert DurationTooShort();
        if (newUnlockTime <= provider.unlockTime) revert InvalidDuration();

        provider.unlockTime = newUnlockTime;

        emit StakeExtended(_msgSender(), newUnlockTime);
    }

    /**
     * @notice Add more tokens to existing stake (extends duration by minStakeDuration)
     * @param amount Amount of tokens to add
     */
    function increaseStake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        ProviderInfo storage provider = providers[_msgSender()];
        if (provider.stakeAmount == 0) revert NotAProvider();
        if (provider.isBanned) revert ProviderBanned();

        provider.stakeAmount += amount;

        uint256 newUnlockTime = block.timestamp + minStakeDuration;
        if (newUnlockTime > provider.unlockTime) {
            provider.unlockTime = newUnlockTime;
        }

        tlpToken.safeTransferFrom(_msgSender(), address(this), amount);

        emit StakeIncreased(_msgSender(), amount, provider.stakeAmount, provider.unlockTime);
    }

    /**
     * @notice Withdraw stake after unlock time
     */
    function withdrawStake() external nonReentrant {
        ProviderInfo storage provider = providers[_msgSender()];
        if (provider.stakeAmount == 0) revert NotAProvider();
        if (block.timestamp < provider.unlockTime) revert StakeLocked();

        uint256 amount = provider.stakeAmount;
        provider.stakeAmount = 0;
        provider.unlockTime = 0;

        tlpToken.safeTransfer(_msgSender(), amount);

        emit StakeWithdrawn(_msgSender(), amount);
    }

    // ============ Police Functions ============

    /**
     * @notice Slash and ban: Remove all stake and ban provider
     * @param provider Address of the provider to slash
     */
    function slashAndBan(address provider) external onlyRole(POLICE_ROLE) nonReentrant {
        ProviderInfo storage providerInfo = providers[provider];
        if (providerInfo.stakeAmount == 0) revert NotAProvider();
        if (providerInfo.isBanned) revert ProviderBanned();

        uint256 slashedAmount = providerInfo.stakeAmount;
        providerInfo.stakeAmount = 0;
        providerInfo.unlockTime = 0;
        providerInfo.isBanned = true;
        providerInfo.slashCount++;

        if (slashedAmount > 0) {
            tlpToken.safeTransfer(treasury, slashedAmount);
        }

        emit ProviderSlashed(provider, slashedAmount, true);
    }

    /**
     * @notice Slash partial stake without banning
     * @param provider Address of the provider to slash
     * @param slashAmount Amount to slash from stake
     */
    function slashPartial(address provider, uint256 slashAmount) external onlyRole(POLICE_ROLE) nonReentrant {
        ProviderInfo storage providerInfo = providers[provider];
        if (providerInfo.stakeAmount == 0) revert NotAProvider();
        if (slashAmount == 0) revert ZeroAmount();
        if (slashAmount > providerInfo.stakeAmount) revert InvalidSlashAmount();

        providerInfo.stakeAmount -= slashAmount;
        providerInfo.slashCount++;

        tlpToken.safeTransfer(treasury, slashAmount);

        emit ProviderSlashed(provider, slashAmount, false);
    }

    /**
     * @notice Unban a previously banned provider
     * @param provider Address of the provider to unban
     */
    function unbanProvider(address provider) external onlyRole(DEFAULT_ADMIN_ROLE) {
        ProviderInfo storage providerInfo = providers[provider];
        if (!providerInfo.isBanned) revert ProviderNotBanned();

        providerInfo.isBanned = false;

        emit ProviderUnbanned(provider);
    }

    // ============ Signer Management ============

    /**
     * @notice Add an authorized signer
     * @param signer Address to authorize as signer
     */
    function addSigner(address signer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (signer == address(0)) revert ZeroAddress();
        if (isSigner[signer]) revert SignerAlreadyAuthorized();

        isSigner[signer] = true;
        signers.push(signer);

        emit SignerAdded(signer);
    }

    /**
     * @notice Remove an authorized signer
     * @param signer Address to remove from signers
     */
    function removeSigner(address signer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isSigner[signer]) revert SignerNotAuthorized();

        isSigner[signer] = false;

        // Remove from signers array
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                break;
            }
        }

        // Adjust required signatures if needed
        if (requiredSignatures > signers.length) {
            uint256 oldRequired = requiredSignatures;
            requiredSignatures = signers.length;
            emit RequiredSignaturesUpdated(oldRequired, requiredSignatures);
        }

        emit SignerRemoved(signer);
    }

    /**
     * @notice Set the number of required signatures
     * @param _required Number of signatures required (k)
     */
    function setRequiredSignatures(uint256 _required) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_required == 0) revert InvalidRequiredSignatures();
        if (_required > signers.length) revert InvalidRequiredSignatures();

        uint256 oldRequired = requiredSignatures;
        requiredSignatures = _required;

        emit RequiredSignaturesUpdated(oldRequired, _required);
    }

    // ============ Admin Functions ============

    /**
     * @notice Update minimum stake duration
     * @param newDuration New minimum stake duration in seconds
     */
    function setMinStakeDuration(uint256 newDuration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newDuration == 0) revert InvalidDuration();

        uint256 oldDuration = minStakeDuration;
        minStakeDuration = newDuration;

        emit MinStakeDurationUpdated(oldDuration, newDuration);
    }

    /**
     * @notice Update treasury address
     * @param newTreasury New treasury address
     */
    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();

        address oldTreasury = treasury;
        treasury = newTreasury;

        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /**
     * @notice Set commission rate for provider claims
     * @param newCommissionBps Commission in basis points (10000 = 100%, e.g., 500 = 5%)
     */
    function setCommission(uint256 newCommissionBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newCommissionBps > 10000) revert CommissionTooHigh();

        uint256 oldCommission = commissionBps;
        commissionBps = newCommissionBps;

        emit CommissionUpdated(oldCommission, newCommissionBps);
    }

    // ============ Internal Functions ============

    /**
     * @notice Verify that the caller is an active provider (staked and not banned)
     */
    function _verifyActiveProvider() internal view {
        ProviderInfo storage provider = providers[_msgSender()];
        if (provider.stakeAmount == 0) revert NotAProvider();
        if (provider.isBanned) revert ProviderBanned();
    }

    /**
     * @notice Process a single claim: validate, verify signatures, update balance
     * @dev Does NOT emit event - caller must emit Claimed after token transfers
     * @param rentalId Rental ID for audit trail
     * @param user Address of the user to claim from
     * @param amount Amount to claim
     * @param deadline Signature expiration timestamp
     * @param signatures Array of signatures from authorized signers
     * @return commission The commission amount for treasury
     * @return providerAmount The amount for the provider (amount - commission)
     */
    function _processClaim(
        bytes32 rentalId,
        address user,
        uint256 amount,
        uint256 deadline,
        bytes[] calldata signatures
    ) internal returns (uint256 commission, uint256 providerAmount) {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (user == address(0)) revert ZeroAddress();
        if (amount > userBalances[user]) revert InsufficientBalance();

        uint256 nonce = nonces[_msgSender()]++;

        _verifySignatures(
            _hashTypedDataV4(
                keccak256(abi.encode(CLAIM_TYPEHASH, rentalId, user, _msgSender(), amount, nonce, deadline))
            ),
            signatures
        );

        userBalances[user] -= amount;

        commission = (amount * commissionBps) / 10000;
        providerAmount = amount - commission;
    }

    /**
     * @notice Verify that enough valid signatures from authorized signers are provided
     * @param digest The EIP712 digest to verify
     * @param signatures Array of signatures
     */
    function _verifySignatures(bytes32 digest, bytes[] calldata signatures) internal view {
        if (signatures.length < requiredSignatures) revert InsufficientSignatures();

        address[] memory usedSigners = new address[](signatures.length);
        uint256 validCount = 0;

        for (uint256 i = 0; i < signatures.length; i++) {
            address recovered = ECDSA.recover(digest, signatures[i]);

            if (!isSigner[recovered]) revert InvalidSignature();

            // Check for duplicate signers
            for (uint256 j = 0; j < validCount; j++) {
                if (usedSigners[j] == recovered) revert DuplicateSignature();
            }

            usedSigners[validCount] = recovered;
            validCount++;

            if (validCount >= requiredSignatures) {
                return;
            }
        }

        revert InsufficientSignatures();
    }

    // ============ View Functions ============

    /**
     * @notice Get provider information
     * @param provider Address of the provider
     * @return stakeAmount Current stake amount
     * @return unlockTime Time when stake can be withdrawn
     * @return isBanned Whether provider is banned
     * @return slashCount Number of times provider has been slashed
     */
    function getProviderInfo(address provider) external view returns (
        uint256 stakeAmount,
        uint256 unlockTime,
        bool isBanned,
        uint256 slashCount
    ) {
        ProviderInfo storage info = providers[provider];
        return (info.stakeAmount, info.unlockTime, info.isBanned, info.slashCount);
    }

    /**
     * @notice Get user's balance in the pool
     * @param user Address of the user
     * @return User's balance
     */
    function getUserBalance(address user) external view returns (uint256) {
        return userBalances[user];
    }

    /**
     * @notice Get current nonce for an address
     * @param account Address to get nonce for
     * @return Current nonce
     */
    function getNonce(address account) external view returns (uint256) {
        return nonces[account];
    }

    /**
     * @notice Check if a provider can currently receive claims
     * @param provider Address of the provider
     * @return True if provider is active
     */
    function isProviderActive(address provider) external view returns (bool) {
        ProviderInfo storage info = providers[provider];
        return info.stakeAmount > 0 && !info.isBanned;
    }

    /**
     * @notice Get all authorized signers
     * @return Array of signer addresses
     */
    function getSigners() external view returns (address[] memory) {
        return signers;
    }

    /**
     * @notice Get the number of authorized signers
     * @return Number of signers
     */
    function getSignerCount() external view returns (uint256) {
        return signers.length;
    }

    /**
     * @notice Get the domain separator for EIP712
     * @return The domain separator
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
