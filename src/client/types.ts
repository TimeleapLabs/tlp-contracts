import type { TypedDataDomain, TypedDataField } from "ethers";

/**
 * Provider staking information
 */
export interface ProviderInfo {
  stakeAmount: bigint;
  unlockTime: bigint;
  isBanned: boolean;
  slashCount: bigint;
}

/**
 * Claim request structure for batch claims
 */
export interface ClaimRequest {
  rentalId: string;
  user: string;
  amount: bigint;
  deadline: bigint;
}

/**
 * EIP712 domain for TLPStaking contract
 */
export interface TLPStakingDomain extends TypedDataDomain {
  name: "TLPStaking";
  version: "1";
  chainId: bigint;
  verifyingContract: string;
}

/**
 * EIP712 type definitions for signature operations
 */
export const EIP712_TYPES: Record<string, TypedDataField[]> = {
  Withdrawal: [
    { name: "user", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  Claim: [
    { name: "rentalId", type: "bytes32" },
    { name: "user", type: "address" },
    { name: "provider", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

/**
 * Withdrawal data for EIP712 signing
 */
export interface WithdrawalData {
  user: string;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}

/**
 * Claim data for EIP712 signing
 */
export interface ClaimData {
  rentalId: string;
  user: string;
  provider: string;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}

/**
 * Event types emitted by the contract
 */

// Provider staking events
export interface StakedEvent {
  provider: string;
  amount: bigint;
  unlockTime: bigint;
}

export interface StakeExtendedEvent {
  provider: string;
  newUnlockTime: bigint;
}

export interface StakeIncreasedEvent {
  provider: string;
  addedAmount: bigint;
  newTotal: bigint;
  newUnlockTime: bigint;
}

export interface StakeWithdrawnEvent {
  provider: string;
  amount: bigint;
}

export interface ProviderSlashedEvent {
  provider: string;
  slashedStake: bigint;
  banned: boolean;
}

export interface ProviderUnbannedEvent {
  provider: string;
}

// User balance events
export interface DepositedEvent {
  user: string;
  amount: bigint;
  newBalance: bigint;
}

export interface WithdrawnEvent {
  user: string;
  amount: bigint;
  newBalance: bigint;
}

// Claim event
export interface ClaimedEvent {
  rentalId: string;
  user: string;
  provider: string;
  amount: bigint;
  commission: bigint;
}

// Admin events
export interface SignerAddedEvent {
  signer: string;
}

export interface SignerRemovedEvent {
  signer: string;
}

export interface RequiredSignaturesUpdatedEvent {
  oldRequired: bigint;
  newRequired: bigint;
}

export interface CommissionUpdatedEvent {
  oldCommission: bigint;
  newCommission: bigint;
}

export interface TreasuryUpdatedEvent {
  oldTreasury: string;
  newTreasury: string;
}

export interface MinStakeDurationUpdatedEvent {
  oldDuration: bigint;
  newDuration: bigint;
}
