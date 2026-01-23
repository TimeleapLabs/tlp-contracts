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
│  │  │ Staking  │ │   Pool   │ │  Signer  │ │  Police  │           │   │
│  │  │  Logic   │ │  Escrow  │ │  Verify  │ │  Logic   │           │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         TLP ERC20 Token                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Design Principle

**Contract = Pool-based escrow. All business logic lives off-chain.**

- Funds flow INTO the pool via user deposits (no signature required)
- Funds flow OUT of the pool only with k-of-n backend signatures
- No assignment of funds to specific providers or rentals on-chain
- Rental IDs in events only (for audit trail)

This design enables seamless provider migration: when a provider goes down, the backend can authorize claims from a different provider without any on-chain refund/re-rental logic.

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

// User Balance Pool
mapping(address => uint256) public userBalances;

// Single nonce per address (for replay protection)
mapping(address => uint256) public nonces;

// Provider State
mapping(address => ProviderInfo) public providers;
uint256 public minStakeDuration = 30 days;

// Signer State
mapping(address => bool) public isSigner;
address[] public signers;
uint256 public requiredSignatures;

// Commission
uint256 public commissionBps;  // Basis points (10000 = 100%)
```

### Data Structures

```solidity
struct ProviderInfo {
    uint256 stakeAmount;    // Total staked TLP
    uint256 unlockTime;     // Timestamp when stake unlocks
    bool isBanned;          // Whether provider is banned
    uint256 slashCount;     // Number of times slashed
}

struct ClaimRequest {
    bytes32 rentalId;       // For audit trail (not stored on-chain)
    address user;           // User to claim from
    uint256 amount;         // Amount to claim
    uint256 deadline;       // Signature expiration
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
// User withdrawing their balance
WITHDRAWAL_TYPEHASH = keccak256(
    "Withdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline)"
);

// Provider claiming from user's balance
CLAIM_TYPEHASH = keccak256(
    "Claim(bytes32 rentalId,address user,address provider,uint256 amount,uint256 nonce,uint256 deadline)"
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
| Withdrawal | Per-user (`nonces[user]`) | Prevent replay of withdrawal requests |
| Claim | Per-provider (`nonces[provider]`) | Prevent replay of claim requests |

Each signature also includes a `deadline` parameter for time-based expiration.

## Access Control

### Roles

```
DEFAULT_ADMIN_ROLE (0x00)
├── Can grant/revoke all roles
├── Can manage signers
├── Can configure signature requirements
├── Can set commission rate
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

### Pool-Based Fund Flow

```
                    ┌─────────────────────┐
                    │   Contract Pool     │
                    │   (holds all TLP)   │
                    └─────────────────────┘
                           ▲    │
          deposit()        │    │  withdraw() [k-of-n sig]
          (no sig)         │    │  claim() [k-of-n sig]
                           │    ▼
┌──────────┐         ┌─────────────┐         ┌──────────────┐
│  Users   │ ───────►│   Backend   │◄─────── │  Providers   │
└──────────┘         │  (off-chain │         └──────────────┘
                     │   logic)    │
                     └─────────────┘
```

### Deposit Flow (No Signature Required)

```
User                    Contract
  │                        │
  │─── approve(TLP) ──────►│
  │                        │
  │─── deposit(amount) ───►│
  │                        │
  │                        │◄─── transferFrom(user, contract)
  │                        │
  │◄── Deposited event ────│
```

### Withdrawal Flow (Requires k-of-n Signatures)

```
User                    Backend                 Contract
  │                        │                        │
  │── Request withdrawal ─►│                        │
  │                        │                        │
  │                        │─── Get nonce ─────────►│
  │                        │◄────── nonce ──────────│
  │                        │                        │
  │                        │─── Sign EIP712 ───────►│
  │                        │    (k-of-n signers)    │
  │                        │                        │
  │◄── signatures ─────────│                        │
  │                        │                        │
  │── withdraw(amount, deadline, signatures) ──────►│
  │                        │                        │
  │◄── transfer(TLP) ──────│────────────────────────│
  │                        │                        │
  │◄── Withdrawn event ────│────────────────────────│
```

### Provider Claim Flow (Requires k-of-n Signatures)

```
Provider                Backend                 Contract         Treasury
    │                      │                        │                │
    │── Request claim ────►│                        │                │
    │   (rentalId, user,   │                        │                │
    │    amount)           │                        │                │
    │                      │─── Get provider nonce ►│                │
    │                      │◄────── nonce ──────────│                │
    │                      │                        │                │
    │                      │─── Sign EIP712 ───────►│                │
    │                      │    (k-of-n signers)    │                │
    │                      │                        │                │
    │◄── signatures ───────│                        │                │
    │                      │                        │                │
    │── claim(rentalId, user, amount, deadline, signatures) ───────►│
    │                      │                        │                │
    │                      │                        │─── commission ►│
    │◄── transfer(TLP - commission) ───────────────│                │
    │                      │                        │                │
    │◄── Claimed event ────│────────────────────────│                │
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
- `deposit()`
- `withdraw()`
- `claim()`
- `batchClaim()`
- `slashAndBan()`
- `slashPartial()`

### Signature Security

1. **Domain Separation**: EIP712 domain includes contract address and chain ID
2. **Nonce Protection**: Each signature is tied to a specific nonce
3. **Deadline Expiration**: Signatures expire after the specified deadline
4. **Duplicate Prevention**: Same signer cannot be used twice in one operation
5. **Signer Validation**: Only registered signers can produce valid signatures

### Access Control Security

1. **Role-Based Access**: Critical functions restricted to specific roles
2. **Admin Controls**: Only admin can modify signer configuration
3. **Police Separation**: Police role cannot modify system configuration

### Token Safety

1. **SafeERC20**: All token transfers use SafeERC20 wrapper
2. **Balance Checks**: Withdrawal/claim amounts validated against available balance
3. **No Arbitrary Transfers**: Tokens can only move through defined flows

## Gas Optimization

### Storage Layout

```solidity
// Packed struct
struct ProviderInfo {
    uint256 stakeAmount;    // slot 0
    uint256 unlockTime;     // slot 1
    bool isBanned;          // slot 2 (packed with slashCount)
    uint256 slashCount;     // slot 2 continued
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

### Batch Operations

```solidity
// batchClaim processes multiple claims with single provider check
function batchClaim(ClaimRequest[] claims, bytes[][] signatures) external {
    // Verify provider once (uses _msgSender() for meta-transaction support)
    _verifyActiveProvider();

    // Process all claims, accumulate totals
    for (uint256 i = 0; i < claims.length; i++) {
        // Validate, verify signatures, update balances, calculate commission
        (uint256 commission, uint256 providerAmount) = _processClaim(...);
        totalCommission += commission;
        totalAmount += providerAmount;
    }

    // Batch token transfers
    if (totalCommission > 0) {
        tlpToken.safeTransfer(treasury, totalCommission);
    }
    tlpToken.safeTransfer(_msgSender(), totalAmount);

    // Emit events after transfers
    for (uint256 i = 0; i < claims.length; i++) {
        emit Claimed(claims[i].rentalId, claims[i].user, _msgSender(), ...);
    }
}
```

## Deployment Configuration

### Constructor Parameters

```solidity
constructor(
    address _tlpToken,    // TLP ERC20 token address
    address _treasury,    // Treasury for commissions and slashed funds
    address _admin        // Initial admin address
)
```

### Post-Deployment Setup

1. Add authorized signers: `addSigner(signer1)`, `addSigner(signer2)`, etc.
2. Set signature requirements: `setRequiredSignatures(k)`
3. Set commission rate: `setCommission(commissionBps)` (e.g., 500 for 5%)
4. Grant police role if needed: `grantRole(POLICE_ROLE, police)`

## Migration Scenario Example

The pool-based architecture enables seamless provider migration:

1. **User deposits 100 TLP** to the pool
2. **Backend tracks usage off-chain** (no on-chain rental state)
3. **Provider A serves user**, then goes down
4. **Backend signs claim** for Provider A: 10 TLP (time used before downtime)
5. **User migrates to Provider B** (backend handles this)
6. **Backend signs claim** for Provider B: 10 TLP (continued service)
7. **User's pool balance**: 80 TLP remaining
8. **No refunds needed** - unused balance stays in pool

This is much simpler than the old rental-based model which required:
- On-chain refund for Rental#1 with Provider A
- User claims refund
- On-chain new Rental#2 with Provider B
- Complex partial time accounting
