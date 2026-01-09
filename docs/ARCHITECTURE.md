# Architecture

This document describes the technical architecture of the TLPStaking system.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                    │
│  (User Interface for Providers, Users, and Admins)                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Backend Services                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Signer    │  │   Signer    │  │   Signer    │  │  Validator  │    │
│  │   Node 1    │  │   Node 2    │  │   Node 3    │  │   Service   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Blockchain Layer                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        TLPStaking Contract                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │   │
│  │  │ Staking  │ │ Rentals  │ │  Signer  │ │  Police  │           │   │
│  │  │  Logic   │ │  Logic   │ │  Verify  │ │  Logic   │           │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         TLP ERC20 Token                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Contract Architecture

### Inheritance Structure

```
                    ┌─────────────────┐
                    │   TLPStaking    │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  AccessControl  │ │ ReentrancyGuard │ │     EIP712      │
│  (OpenZeppelin) │ │  (OpenZeppelin) │ │  (OpenZeppelin) │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### State Variables

```solidity
// Token and Treasury
IERC20 public immutable tlpToken;
address public treasury;

// Provider State
mapping(address => ProviderInfo) public providers;
uint256 public minStakeDuration = 30 days;

// Rental State
mapping(bytes32 => Rental) public rentals;
mapping(address => bytes32[]) public userRentals;
mapping(address => bytes32[]) public providerRentals;
mapping(bytes32 => uint256) public vmPricePerSecond;

// Signer State
mapping(address => bool) public isSigner;
address[] public signers;
uint256 public requiredRentalSignatures;
uint256 public requiredWithdrawalSignatures;
uint256 public requiredRefundSignatures;

// Nonce State (Replay Protection)
mapping(address => uint256) public rentalNonces;      // per-user
mapping(bytes32 => uint256) public withdrawalNonces;  // per-rental
mapping(bytes32 => uint256) public refundNonces;      // per-rental
```

### Data Structures

```solidity
struct ProviderInfo {
    uint256 stakeAmount;    // Total staked TLP
    uint256 unlockTime;     // Timestamp when stake unlocks
    bool isBanned;          // Whether provider is banned
}

struct Rental {
    address user;           // User who rented
    address provider;       // Provider who served
    uint256 amount;         // Original rental amount
    uint256 timestamp;      // When rental was created
    bytes32 vm;             // VM type identifier
    uint256 duration;       // Rental duration in seconds
    uint256 withdrawnAmount; // Total withdrawn by provider
    uint256 refundedAmount;  // Total refunded to user
}
```

## Signature System

### EIP712 Domain

```solidity
EIP712("TLPStaking", "1")

Domain Separator:
{
    name: "TLPStaking",
    version: "1",
    chainId: <network chain ID>,
    verifyingContract: <contract address>
}
```

### Type Hashes

```solidity
RENTAL_TYPEHASH = keccak256(
    "RentalApproval(bytes32 rentalId,address user,address provider,bytes32 vm,uint256 duration,uint256 nonce)"
);

WITHDRAWAL_TYPEHASH = keccak256(
    "WithdrawalApproval(bytes32 rentalId,address provider,uint256 amount,uint256 nonce)"
);

REFUND_TYPEHASH = keccak256(
    "RefundApproval(bytes32 rentalId,address user,uint256 amount,uint256 nonce)"
);
```

### Signature Verification Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Message   │ ──► │  EIP712     │ ──► │   Digest    │
│   Data      │     │  Encoding   │     │   Hash      │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Valid?    │ ◄── │   Check     │ ◄── │   ECDSA     │
│   k-of-n    │     │   Signer    │     │   Recover   │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Nonce Strategy

| Action | Nonce Source | Purpose |
|--------|--------------|---------|
| Rental | Per-user (`rentalNonces[user]`) | Prevent replay of same rental request |
| Withdrawal | Per-rental (`withdrawalNonces[rentalId]`) | Allow multiple partial withdrawals |
| Refund | Per-rental (`refundNonces[rentalId]`) | Allow multiple partial refunds |

## Access Control

### Roles

```
DEFAULT_ADMIN_ROLE (0x00)
├── Can grant/revoke all roles
├── Can manage signers
├── Can configure signature requirements
├── Can set VM prices
├── Can update treasury
├── Can update min stake duration
└── Can unban providers

POLICE_ROLE
├── Can slash providers (full or partial)
└── Can ban providers
```

### Role Hierarchy

```
┌────────────────────────────────────────┐
│           DEFAULT_ADMIN_ROLE           │
│  (Full administrative control)         │
└────────────────────┬───────────────────┘
                     │ grants
                     ▼
┌────────────────────────────────────────┐
│              POLICE_ROLE               │
│  (Slashing and banning only)           │
└────────────────────────────────────────┘
```

## Financial Flows

### Rental Payment Flow

```
User                    Contract                Provider
  │                        │                        │
  │─── approve(TLP) ──────►│                        │
  │                        │                        │
  │─── rentFromProvider ──►│                        │
  │    (with signatures)   │                        │
  │                        │◄─── transferFrom ─────►│
  │                        │     (TLP locked)       │
  │                        │                        │
  │◄── RentalCreated ──────│                        │
```

### Withdrawal Flow

```
Provider                Contract                Treasury
    │                       │                       │
    │── withdrawRental ────►│                       │
    │   (with signatures)   │                       │
    │                       │                       │
    │◄── transfer(TLP) ─────│                       │
    │                       │                       │
    │◄── RentalWithdrawn ───│                       │
```

### Refund Flow

```
User                    Contract                Provider
  │                        │                        │
  │─── claimRefund ───────►│                        │
  │    (with signatures)   │                        │
  │                        │                        │
  │◄── transfer(TLP) ──────│                        │
  │                        │                        │
  │◄── RefundClaimed ──────│                        │
```

### Slashing Flow

```
Police                  Contract                Treasury
   │                       │                       │
   │── slashAndBan ───────►│                       │
   │                       │                       │
   │                       │─── transfer(TLP) ────►│
   │                       │                       │
   │◄── ProviderSlashed ───│                       │
```

## Security Considerations

### Reentrancy Protection

All functions that transfer tokens use the `nonReentrant` modifier:
- `stake()`
- `increaseStake()`
- `withdrawStake()`
- `rentFromProvider()`
- `claimRefund()`
- `withdrawRental()`
- `slashAndBan()`
- `slashPartial()`

### Signature Security

1. **Domain Separation**: EIP712 domain includes contract address and chain ID
2. **Nonce Protection**: Each signature is tied to a specific nonce
3. **Duplicate Prevention**: Same signer cannot be used twice in one operation
4. **Signer Validation**: Only registered signers can produce valid signatures

### Access Control Security

1. **Role-Based Access**: Critical functions restricted to specific roles
2. **Admin Controls**: Only admin can modify signer configuration
3. **Police Separation**: Police role cannot modify system configuration

### Token Safety

1. **SafeERC20**: All token transfers use SafeERC20 wrapper
2. **Balance Checks**: Withdrawal/refund amounts validated against available balance
3. **No Arbitrary Transfers**: Tokens can only move through defined flows

## Gas Optimization

### Storage Layout

```solidity
// Packed struct (1 slot for amounts, 1 slot for booleans)
struct ProviderInfo {
    uint256 stakeAmount;    // slot 0
    uint256 unlockTime;     // slot 1
    bool isBanned;          // slot 2 (1 byte)
}

// Rental amounts tracked cumulatively (not per-action)
struct Rental {
    // ... addresses and amounts in separate slots
    uint256 withdrawnAmount;  // cumulative, not boolean
    uint256 refundedAmount;   // cumulative, not boolean
}
```

### Efficient Signature Verification

```solidity
// Early exit when enough valid signatures found
function _verifySignatures(...) internal view {
    for (uint256 i = 0; i < signatures.length; i++) {
        // ... verify signature
        validCount++;
        if (validCount >= required) {
            return;  // Early exit
        }
    }
}
```

## Deployment Configuration

### Constructor Parameters

```solidity
constructor(
    address _tlpToken,    // TLP ERC20 token address
    address _treasury,    // Treasury for slashed funds
    address _admin        // Initial admin address
)
```

### Post-Deployment Setup

1. Add authorized signers: `addSigner(signer1)`, `addSigner(signer2)`, etc.
2. Set signature requirements: `setRequiredRentalSignatures(k)`
3. Configure VM prices: `setVmPrice(vmId, pricePerSecond)`
4. Grant police role if needed: `grantRole(POLICE_ROLE, police)`
