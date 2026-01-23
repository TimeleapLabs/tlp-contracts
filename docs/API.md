# API Reference

Complete API documentation for the TLPStaking smart contract.

## Table of Contents

- [Read Functions](#read-functions)
- [Write Functions](#write-functions)
- [Events](#events)
- [Errors](#errors)
- [Constants](#constants)

---

## Read Functions

### User Balance Queries

#### `getUserBalance(address user)`

Returns a user's balance in the pool.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| user | address | User address |

**Returns:**
| Type | Description |
|------|-------------|
| uint256 | User's balance in the pool |

**Example:**
```solidity
uint256 balance = staking.getUserBalance(userAddress);
```

---

#### `getNonce(address account)`

Returns the current nonce for an address. Used for replay protection.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| account | address | Account address |

**Returns:**
| Type | Description |
|------|-------------|
| uint256 | Current nonce |

---

### Provider Queries

#### `getProviderInfo(address provider)`

Returns staking information for a provider.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| provider | address | Provider address |

**Returns:**
| Name | Type | Description |
|------|------|-------------|
| stakeAmount | uint256 | Amount of TLP staked |
| unlockTime | uint256 | Timestamp when stake unlocks |
| isBanned | bool | Whether provider is banned |
| slashCount | uint256 | Number of times provider has been slashed |

**Example:**
```solidity
(uint256 stake, uint256 unlock, bool banned, uint256 slashes) = staking.getProviderInfo(providerAddress);
```

---

#### `isProviderActive(address provider)`

Checks if a provider can receive claims.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| provider | address | Provider address |

**Returns:**
| Type | Description |
|------|-------------|
| bool | True if provider is staked and not banned |

---

### Signer Queries

#### `getSigners()`

Returns all authorized signer addresses.

**Returns:**
| Type | Description |
|------|-------------|
| address[] | Array of signer addresses |

---

#### `getSignerCount()`

Returns number of authorized signers.

**Returns:**
| Type | Description |
|------|-------------|
| uint256 | Number of signers |

---

#### `isSigner(address account)`

Checks if an address is an authorized signer.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| account | address | Address to check |

**Returns:**
| Type | Description |
|------|-------------|
| bool | True if address is a signer |

---

#### `requiredSignatures()`

Returns number of signatures required for operations.

**Returns:**
| Type | Description |
|------|-------------|
| uint256 | Required signature count |

---

### Configuration Queries

#### `minStakeDuration()`

Returns minimum staking duration.

**Returns:**
| Type | Description |
|------|-------------|
| uint256 | Duration in seconds (default: 30 days) |

---

#### `commissionBps()`

Returns the commission rate in basis points.

**Returns:**
| Type | Description |
|------|-------------|
| uint256 | Commission in basis points (10000 = 100%) |

---

#### `treasury()`

Returns the treasury address.

**Returns:**
| Type | Description |
|------|-------------|
| address | Treasury address |

---

#### `tlpToken()`

Returns the TLP token address.

**Returns:**
| Type | Description |
|------|-------------|
| address | TLP token contract address |

---

#### `domainSeparator()`

Returns EIP712 domain separator.

**Returns:**
| Type | Description |
|------|-------------|
| bytes32 | Domain separator hash |

---

## Write Functions

### User Functions

#### `deposit(uint256 amount)`

Deposits TLP tokens to user's balance in the pool. No signature required.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| amount | uint256 | Amount of TLP to deposit |

**Requirements:**
- `amount > 0`
- Caller must have approved TLP spending

**Emits:** `Deposited(user, amount, newBalance)`

---

#### `withdraw(uint256 amount, uint256 deadline, bytes[] signatures)`

Withdraws tokens from user's balance. Requires k-of-n signatures.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| amount | uint256 | Amount to withdraw |
| deadline | uint256 | Signature expiration timestamp |
| signatures | bytes[] | EIP712 signatures from authorized signers |

**Requirements:**
- `amount > 0`
- `amount <= userBalances[caller]`
- `block.timestamp <= deadline`
- Sufficient valid signatures

**Emits:** `Withdrawn(user, amount, newBalance)`

---

### Provider Functions

#### `stake(uint256 amount, uint256 duration)`

Stakes TLP tokens to become a provider.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| amount | uint256 | Amount of TLP to stake |
| duration | uint256 | Lock duration in seconds (>= minStakeDuration) |

**Requirements:**
- `amount > 0`
- `duration >= minStakeDuration`
- Caller must not already be staked
- Caller must not be banned
- Caller must have approved TLP spending

**Emits:** `Staked(provider, amount, unlockTime)`

---

#### `extendStakeDuration(uint256 newUnlockTime)`

Extends stake lock duration.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| newUnlockTime | uint256 | New unlock timestamp |

**Requirements:**
- Caller must be a provider
- `newUnlockTime >= block.timestamp + minStakeDuration`
- `newUnlockTime > currentUnlockTime`

**Emits:** `StakeExtended(provider, newUnlockTime)`

---

#### `increaseStake(uint256 amount)`

Adds more tokens to existing stake.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| amount | uint256 | Additional TLP to stake |

**Requirements:**
- `amount > 0`
- Caller must be a provider
- Caller must not be banned

**Emits:** `StakeIncreased(provider, addedAmount, newTotal, newUnlockTime)`

---

#### `withdrawStake()`

Withdraws entire stake after unlock time.

**Requirements:**
- Caller must be a provider
- `block.timestamp >= unlockTime`

**Emits:** `StakeWithdrawn(provider, amount)`

---

### Provider Claim Functions

#### `claim(bytes32 rentalId, address user, uint256 amount, uint256 deadline, bytes[] signatures)`

Provider claims from a user's balance. Requires k-of-n signatures.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| rentalId | bytes32 | Rental ID for audit trail (not stored on-chain) |
| user | address | Address of user to claim from |
| amount | uint256 | Amount to claim |
| deadline | uint256 | Signature expiration timestamp |
| signatures | bytes[] | EIP712 signatures from authorized signers |

**Requirements:**
- Caller must be an active provider (staked and not banned)
- `amount > 0`
- `amount <= userBalances[user]`
- `block.timestamp <= deadline`
- Sufficient valid signatures

**Emits:** `Claimed(rentalId, user, provider, amount, commission)`

**Note:** Commission is deducted and sent to treasury. Provider receives `amount - commission`.

---

#### `batchClaim(ClaimRequest[] claims, bytes[][] signatures)`

Provider claims from multiple users in a single transaction.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| claims | ClaimRequest[] | Array of claim requests |
| signatures | bytes[][] | Array of signature arrays for each claim |

**ClaimRequest struct:**
```solidity
struct ClaimRequest {
    bytes32 rentalId;   // For audit trail
    address user;       // User to claim from
    uint256 amount;     // Amount to claim
    uint256 deadline;   // Signature expiration
}
```

**Requirements:**
- Caller must be an active provider
- `claims.length == signatures.length`
- For each claim: `amount > 0`, sufficient balance, valid signatures

**Emits:** `Claimed(rentalId, user, provider, amount, commission)` for each claim

---

### Admin Functions

#### `addSigner(address signer)`

Adds an authorized signer.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| signer | address | Signer address to add |

**Requirements:**
- Caller has DEFAULT_ADMIN_ROLE
- `signer != address(0)`
- Signer not already authorized

**Emits:** `SignerAdded(signer)`

---

#### `removeSigner(address signer)`

Removes an authorized signer.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| signer | address | Signer address to remove |

**Requirements:**
- Caller has DEFAULT_ADMIN_ROLE
- Signer is currently authorized

**Emits:** `SignerRemoved(signer)`

**Note:** If required signatures exceed remaining signers, requirements are automatically reduced.

---

#### `setRequiredSignatures(uint256 _required)`

Sets required signatures for operations.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| _required | uint256 | Number of required signatures |

**Requirements:**
- Caller has DEFAULT_ADMIN_ROLE
- `_required > 0`
- `_required <= signers.length`

**Emits:** `RequiredSignaturesUpdated(oldRequired, newRequired)`

---

#### `setMinStakeDuration(uint256 newDuration)`

Sets minimum stake duration.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| newDuration | uint256 | New duration in seconds |

**Emits:** `MinStakeDurationUpdated(oldDuration, newDuration)`

---

#### `setCommission(uint256 newCommissionBps)`

Sets commission rate for provider claims.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| newCommissionBps | uint256 | Commission in basis points (10000 = 100%) |

**Requirements:**
- Caller has DEFAULT_ADMIN_ROLE
- `newCommissionBps <= 10000`

**Emits:** `CommissionUpdated(oldCommission, newCommission)`

---

#### `setTreasury(address newTreasury)`

Sets treasury address for commissions and slashed funds.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| newTreasury | address | New treasury address |

**Requirements:**
- Caller has DEFAULT_ADMIN_ROLE
- `newTreasury != address(0)`

**Emits:** `TreasuryUpdated(oldTreasury, newTreasury)`

---

### Police Functions

#### `slashAndBan(address provider)`

Slashes all stake and bans provider.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| provider | address | Provider to slash |

**Requirements:**
- Caller has POLICE_ROLE
- Provider has stake (`stakeAmount > 0`)

**Emits:** `ProviderSlashed(provider, slashedAmount, true)`

---

#### `slashPartial(address provider, uint256 slashAmount)`

Slashes partial stake without banning.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| provider | address | Provider to slash |
| slashAmount | uint256 | Amount to slash |

**Requirements:**
- Caller has POLICE_ROLE
- Provider is staked
- `slashAmount > 0`
- `slashAmount <= stakeAmount`

**Emits:** `ProviderSlashed(provider, slashAmount, false)`

---

#### `unbanProvider(address provider)`

Unbans a previously banned provider.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| provider | address | Provider to unban |

**Requirements:**
- Caller has POLICE_ROLE
- Provider is currently banned

**Emits:** `ProviderUnbanned(provider)`

---

## Events

| Event | Parameters | Description |
|-------|------------|-------------|
| `Staked` | provider, amount, unlockTime | Provider staked tokens |
| `StakeExtended` | provider, newUnlockTime | Stake duration extended |
| `StakeIncreased` | provider, addedAmount, newTotal, newUnlockTime | Additional tokens staked |
| `StakeWithdrawn` | provider, amount | Provider withdrew stake |
| `Deposited` | user, amount, newBalance | User deposited to pool |
| `Withdrawn` | user, amount, newBalance | User withdrew from pool |
| `Claimed` | rentalId, user, provider, amount, commission | Provider claimed from user |
| `ProviderSlashed` | provider, slashedStake, banned | Provider was slashed |
| `ProviderUnbanned` | provider | Provider was unbanned |
| `SignerAdded` | signer | New signer authorized |
| `SignerRemoved` | signer | Signer removed |
| `RequiredSignaturesUpdated` | oldRequired, newRequired | Signature requirement changed |
| `CommissionUpdated` | oldCommission, newCommission | Commission rate changed |
| `MinStakeDurationUpdated` | oldDuration, newDuration | Min duration changed |
| `TreasuryUpdated` | oldTreasury, newTreasury | Treasury address changed |

---

## Errors

| Error | Description |
|-------|-------------|
| `ZeroAddress()` | Address parameter is zero |
| `ZeroAmount()` | Amount parameter is zero |
| `InsufficientBalance()` | Not enough balance for operation |
| `StakeLocked()` | Stake still locked |
| `AlreadyStaked()` | Provider already has an active stake |
| `ProviderBanned()` | Provider is banned |
| `ProviderNotBanned()` | Provider not banned (for unban) |
| `NotAProvider()` | Address is not a provider |
| `DurationTooShort()` | Duration below minimum |
| `SignatureExpired()` | Signature deadline has passed |
| `SignerAlreadyAuthorized()` | Signer already added |
| `SignerNotAuthorized()` | Signer not found |
| `InsufficientSignatures()` | Not enough valid signatures |
| `DuplicateSignature()` | Same signer used twice |
| `InvalidSignature()` | Signature from non-signer |
| `InvalidRequiredSignatures()` | Invalid signature requirement |
| `ArrayLengthMismatch()` | Arrays have different lengths in batch operations |
| `CommissionTooHigh()` | Commission exceeds 100% |

---

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `POLICE_ROLE` | `keccak256("POLICE_ROLE")` | Role for slashing |
| `DEFAULT_ADMIN_ROLE` | `0x00...00` | Admin role |
| `minStakeDuration` | 30 days (default) | Minimum stake lock |

---

## EIP712 Types

### Withdrawal Type

```solidity
bytes32 WITHDRAWAL_TYPEHASH = keccak256(
    "Withdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline)"
);
```

### Claim Type

```solidity
bytes32 CLAIM_TYPEHASH = keccak256(
    "Claim(bytes32 rentalId,address user,address provider,uint256 amount,uint256 nonce,uint256 deadline)"
);
```
