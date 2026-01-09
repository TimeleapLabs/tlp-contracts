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
 * @notice Staking contract for Timeleap compute providers and VM rentals
 * @dev Providers stake TLP tokens, users rent VM resources from providers.
 *      Police can slash misbehaving providers.
 *      Rentals, withdrawals, and refunds require k-of-n EIP712 signatures from authorized signers.
 *      Each action type can have a different k value configured independently.
 *      Withdrawal and refund amounts are determined by backend signatures (not on-chain state).
 */
contract TLPStaking is AccessControl, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ============ Roles ============
    bytes32 public constant POLICE_ROLE = keccak256("POLICE_ROLE");

    // ============ EIP712 Type Hashes ============
    bytes32 public constant RENTAL_TYPEHASH =
        keccak256("RentalApproval(bytes32 rentalId,address user,address provider,bytes32 vm,uint256 duration,uint256 nonce)");
    bytes32 public constant WITHDRAWAL_TYPEHASH =
        keccak256("WithdrawalApproval(bytes32 rentalId,address provider,uint256 amount,uint256 nonce)");
    bytes32 public constant REFUND_TYPEHASH =
        keccak256("RefundApproval(bytes32 rentalId,address user,uint256 amount,uint256 nonce)");

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
    error RentalNotFound();
    error RentalAlreadyExists();
    error AmountExceedsAvailable();
    error NothingToWithdraw();
    error InvalidSlashAmount();
    error VmNotConfigured();
    error SignerAlreadyAuthorized();
    error SignerNotAuthorized();
    error InsufficientSignatures();
    error DuplicateSignature();
    error InvalidSignature();
    error InvalidRequiredSignatures();
    error RentalExceedsStakeDuration();
    error ArrayLengthMismatch();

    // ============ Events ============
    event Staked(address indexed provider, uint256 amount, uint256 unlockTime);
    event StakeExtended(address indexed provider, uint256 newUnlockTime);
    event StakeIncreased(address indexed provider, uint256 addedAmount, uint256 newTotal, uint256 newUnlockTime);
    event StakeWithdrawn(address indexed provider, uint256 amount);

    event RentalCreated(
        address indexed user,
        address indexed provider,
        bytes32 indexed rentalId,
        uint256 amount,
        bytes32 vm,
        uint256 duration
    );
    event RentalWithdrawn(address indexed provider, bytes32 indexed rentalId, uint256 amount);
    event RefundClaimed(address indexed user, address indexed provider, bytes32 indexed rentalId, uint256 amount);

    event ProviderSlashed(address indexed provider, uint256 slashedStake, bool banned);
    event ProviderUnbanned(address indexed provider);

    event MinStakeDurationUpdated(uint256 oldDuration, uint256 newDuration);
    event RentalGracePeriodUpdated(uint256 oldPeriod, uint256 newPeriod);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event VmPriceUpdated(bytes32 indexed vm, uint256 oldPrice, uint256 newPrice);

    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event RequiredRentalSignaturesUpdated(uint256 oldRequired, uint256 newRequired);
    event RequiredWithdrawalSignaturesUpdated(uint256 oldRequired, uint256 newRequired);
    event RequiredRefundSignaturesUpdated(uint256 oldRequired, uint256 newRequired);

    // ============ Structs ============
    struct ProviderInfo {
        uint256 stakeAmount;
        uint256 unlockTime;
        bool isBanned;
        uint256 slashCount;
    }

    struct Rental {
        address user;
        address provider;
        uint256 amount;
        uint256 timestamp;
        bytes32 vm;
        uint256 duration;
        uint256 withdrawnAmount;
        uint256 refundedAmount;
    }

    // ============ State Variables ============
    IERC20 public immutable tlpToken;
    address public treasury;

    uint256 public minStakeDuration = 30 days;
    uint256 public rentalGracePeriod = 7 days;

    mapping(address => ProviderInfo) public providers;
    mapping(bytes32 => uint256) public vmPricePerSecond;

    mapping(bytes32 => Rental) public rentals;
    mapping(address => bytes32[]) public userRentals;
    mapping(address => bytes32[]) public providerRentals;

    // Signer management
    mapping(address => bool) public isSigner;
    address[] public signers;
    uint256 public requiredRentalSignatures;
    uint256 public requiredWithdrawalSignatures;
    uint256 public requiredRefundSignatures;

    // Nonces for replay protection
    mapping(address => uint256) public rentalNonces;
    mapping(bytes32 => uint256) public withdrawalNonces;
    mapping(bytes32 => uint256) public refundNonces;

    // ============ Constructor ============
    /**
     * @notice Initializes the staking contract
     * @param _tlpToken Address of the TLP token
     * @param _treasury Address where slashed funds are sent
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

    // ============ Provider Functions ============

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

    // ============ User Functions ============

    /**
     * @notice Rent compute resources from a provider
     * @param rentalId Unique rental ID (generated by backend)
     * @param provider Address of the provider
     * @param vm VM type identifier
     * @param duration Duration of the VM rental in seconds
     * @param signatures Array of signatures from authorized signers
     */
    function rentFromProvider(
        bytes32 rentalId,
        address provider,
        bytes32 vm,
        uint256 duration,
        bytes[] calldata signatures
    ) external nonReentrant {
        if (rentalId == bytes32(0)) revert RentalNotFound();
        if (provider == address(0)) revert ZeroAddress();
        if (duration == 0) revert InvalidDuration();

        // Check rental doesn't already exist
        if (rentals[rentalId].user != address(0)) revert RentalAlreadyExists();

        uint256 pricePerSecond = vmPricePerSecond[vm];
        if (pricePerSecond == 0) revert VmNotConfigured();

        uint256 amount = pricePerSecond * duration;

        ProviderInfo storage providerInfo = providers[provider];
        if (providerInfo.isBanned) revert ProviderBanned();
        if (providerInfo.stakeAmount == 0) revert NotAProvider();
        if (block.timestamp + duration + rentalGracePeriod > providerInfo.unlockTime) {
            revert RentalExceedsStakeDuration();
        }

        uint256 nonce = rentalNonces[_msgSender()]++;

        // Verify signatures
        _verifySignatures(
            _hashTypedDataV4(
                keccak256(abi.encode(RENTAL_TYPEHASH, rentalId, _msgSender(), provider, vm, duration, nonce))
            ),
            signatures,
            requiredRentalSignatures
        );

        rentals[rentalId] = Rental({
            user: _msgSender(),
            provider: provider,
            amount: amount,
            timestamp: block.timestamp,
            vm: vm,
            duration: duration,
            withdrawnAmount: 0,
            refundedAmount: 0
        });

        userRentals[_msgSender()].push(rentalId);
        providerRentals[provider].push(rentalId);

        tlpToken.safeTransferFrom(_msgSender(), address(this), amount);

        emit RentalCreated(_msgSender(), provider, rentalId, amount, vm, duration);
    }

    /**
     * @notice Claim refund for a rental with k-of-n signer approval
     * @param rentalId ID of the rental to refund
     * @param amount Amount to refund (must match signed amount)
     * @param signatures Array of signatures from authorized signers
     */
    function claimRefund(bytes32 rentalId, uint256 amount, bytes[] calldata signatures) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Rental storage rental = rentals[rentalId];
        if (rental.user == address(0)) revert RentalNotFound();
        if (rental.user != _msgSender()) revert RentalNotFound();

        uint256 available = rental.amount - rental.withdrawnAmount - rental.refundedAmount;
        if (amount > available) revert AmountExceedsAvailable();

        uint256 nonce = refundNonces[rentalId]++;

        // Verify signatures
        _verifySignatures(
            _hashTypedDataV4(
                keccak256(abi.encode(REFUND_TYPEHASH, rentalId, _msgSender(), amount, nonce))
            ),
            signatures,
            requiredRefundSignatures
        );

        rental.refundedAmount += amount;

        tlpToken.safeTransfer(_msgSender(), amount);

        emit RefundClaimed(_msgSender(), rental.provider, rentalId, amount);
    }

    /**
     * @notice Provider withdraws rental proceeds with k-of-n signer approval
     * @param rentalId ID of the rental to withdraw
     * @param amount Amount to withdraw (must match signed amount)
     * @param signatures Array of signatures from authorized signers
     */
    function withdrawRental(bytes32 rentalId, uint256 amount, bytes[] calldata signatures) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Rental storage rental = rentals[rentalId];
        if (rental.user == address(0)) revert RentalNotFound();
        if (rental.provider != _msgSender()) revert RentalNotFound();

        uint256 available = rental.amount - rental.withdrawnAmount - rental.refundedAmount;
        if (amount > available) revert AmountExceedsAvailable();

        uint256 nonce = withdrawalNonces[rentalId]++;

        // Verify signatures
        _verifySignatures(
            _hashTypedDataV4(
                keccak256(abi.encode(WITHDRAWAL_TYPEHASH, rentalId, _msgSender(), amount, nonce))
            ),
            signatures,
            requiredWithdrawalSignatures
        );

        rental.withdrawnAmount += amount;

        tlpToken.safeTransfer(_msgSender(), amount);

        emit RentalWithdrawn(_msgSender(), rentalId, amount);
    }

    /**
     * @notice Provider withdraws from multiple rentals in a single transaction
     * @param rentalIds Array of rental IDs to withdraw from
     * @param amounts Array of amounts to withdraw from each rental
     * @param signatures Array of signature arrays for each withdrawal
     */
    function batchWithdrawRental(
        bytes32[] calldata rentalIds,
        uint256[] calldata amounts,
        bytes[][] calldata signatures
    ) external nonReentrant {
        uint256 length = rentalIds.length;
        if (length != amounts.length || length != signatures.length) revert ArrayLengthMismatch();

        uint256 totalAmount = 0;

        for (uint256 i = 0; i < length; i++) {
            bytes32 rentalId = rentalIds[i];
            uint256 amount = amounts[i];

            if (amount == 0) revert ZeroAmount();

            Rental storage rental = rentals[rentalId];
            if (rental.user == address(0)) revert RentalNotFound();
            if (rental.provider != _msgSender()) revert RentalNotFound();

            uint256 available = rental.amount - rental.withdrawnAmount - rental.refundedAmount;
            if (amount > available) revert AmountExceedsAvailable();

            uint256 nonce = withdrawalNonces[rentalId]++;

            // Verify signatures
            _verifySignatures(
                _hashTypedDataV4(
                    keccak256(abi.encode(WITHDRAWAL_TYPEHASH, rentalId, _msgSender(), amount, nonce))
                ),
                signatures[i],
                requiredWithdrawalSignatures
            );

            rental.withdrawnAmount += amount;
            totalAmount += amount;

            emit RentalWithdrawn(_msgSender(), rentalId, amount);
        }

        if (totalAmount > 0) {
            tlpToken.safeTransfer(_msgSender(), totalAmount);
        }
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
        if (requiredRentalSignatures > signers.length) {
            uint256 oldRequired = requiredRentalSignatures;
            requiredRentalSignatures = signers.length;
            emit RequiredRentalSignaturesUpdated(oldRequired, requiredRentalSignatures);
        }
        if (requiredWithdrawalSignatures > signers.length) {
            uint256 oldRequired = requiredWithdrawalSignatures;
            requiredWithdrawalSignatures = signers.length;
            emit RequiredWithdrawalSignaturesUpdated(oldRequired, requiredWithdrawalSignatures);
        }
        if (requiredRefundSignatures > signers.length) {
            uint256 oldRequired = requiredRefundSignatures;
            requiredRefundSignatures = signers.length;
            emit RequiredRefundSignaturesUpdated(oldRequired, requiredRefundSignatures);
        }

        emit SignerRemoved(signer);
    }

    /**
     * @notice Set the number of required signatures for rentals
     * @param _required Number of signatures required (k)
     */
    function setRequiredRentalSignatures(uint256 _required) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_required == 0) revert InvalidRequiredSignatures();
        if (_required > signers.length) revert InvalidRequiredSignatures();

        uint256 oldRequired = requiredRentalSignatures;
        requiredRentalSignatures = _required;

        emit RequiredRentalSignaturesUpdated(oldRequired, _required);
    }

    /**
     * @notice Set the number of required signatures for withdrawals
     * @param _required Number of signatures required (k)
     */
    function setRequiredWithdrawalSignatures(uint256 _required) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_required == 0) revert InvalidRequiredSignatures();
        if (_required > signers.length) revert InvalidRequiredSignatures();

        uint256 oldRequired = requiredWithdrawalSignatures;
        requiredWithdrawalSignatures = _required;

        emit RequiredWithdrawalSignaturesUpdated(oldRequired, _required);
    }

    /**
     * @notice Set the number of required signatures for refunds
     * @param _required Number of signatures required (k)
     */
    function setRequiredRefundSignatures(uint256 _required) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_required == 0) revert InvalidRequiredSignatures();
        if (_required > signers.length) revert InvalidRequiredSignatures();

        uint256 oldRequired = requiredRefundSignatures;
        requiredRefundSignatures = _required;

        emit RequiredRefundSignaturesUpdated(oldRequired, _required);
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
     * @notice Update rental grace period
     * @param newPeriod New grace period in seconds
     */
    function setRentalGracePeriod(uint256 newPeriod) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldPeriod = rentalGracePeriod;
        rentalGracePeriod = newPeriod;

        emit RentalGracePeriodUpdated(oldPeriod, newPeriod);
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
     * @notice Set price per second for a VM type
     * @param vm VM type identifier
     * @param pricePerSecond Price per second in TLP tokens (0 to disable)
     */
    function setVmPrice(bytes32 vm, uint256 pricePerSecond) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldPrice = vmPricePerSecond[vm];
        vmPricePerSecond[vm] = pricePerSecond;

        emit VmPriceUpdated(vm, oldPrice, pricePerSecond);
    }

    // ============ Internal Functions ============

    /**
     * @notice Verify that enough valid signatures from authorized signers are provided
     * @param digest The EIP712 digest to verify
     * @param signatures Array of signatures
     * @param required Number of signatures required
     */
    function _verifySignatures(bytes32 digest, bytes[] calldata signatures, uint256 required) internal view {
        if (signatures.length < required) revert InsufficientSignatures();

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

            if (validCount >= required) {
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
     * @notice Get rental information
     * @param rentalId ID of the rental
     * @return Rental struct with all rental details
     */
    function getRental(bytes32 rentalId) external view returns (Rental memory) {
        Rental storage rental = rentals[rentalId];
        if (rental.user == address(0)) revert RentalNotFound();
        return rental;
    }

    /**
     * @notice Get all rental IDs for a user
     * @param user Address of the user
     * @return Array of rental IDs
     */
    function getUserRentals(address user) external view returns (bytes32[] memory) {
        return userRentals[user];
    }

    /**
     * @notice Get all rental IDs received by a provider
     * @param provider Address of the provider
     * @return Array of rental IDs
     */
    function getProviderRentals(address provider) external view returns (bytes32[] memory) {
        return providerRentals[provider];
    }

    /**
     * @notice Check if a provider can currently receive rentals
     * @param provider Address of the provider
     * @return True if provider is active and can receive rentals
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
