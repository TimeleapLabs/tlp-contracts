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
 * Rental record for VM resource usage
 */
export interface Rental {
  user: string;
  provider: string;
  amount: bigint;
  timestamp: bigint;
  vm: string;
  duration: bigint;
  withdrawnAmount: bigint;
  refundedAmount: bigint;
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
  RentalApproval: [
    { name: "rentalId", type: "bytes32" },
    { name: "user", type: "address" },
    { name: "provider", type: "address" },
    { name: "vm", type: "bytes32" },
    { name: "duration", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
  WithdrawalApproval: [
    { name: "rentalId", type: "bytes32" },
    { name: "provider", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
  RefundApproval: [
    { name: "rentalId", type: "bytes32" },
    { name: "user", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

/**
 * Rental approval data for EIP712 signing
 */
export interface RentalApprovalData {
  rentalId: string;
  user: string;
  provider: string;
  vm: string;
  duration: bigint;
  nonce: bigint;
}

/**
 * Withdrawal approval data for EIP712 signing
 */
export interface WithdrawalApprovalData {
  rentalId: string;
  provider: string;
  amount: bigint;
  nonce: bigint;
}

/**
 * Refund approval data for EIP712 signing
 */
export interface RefundApprovalData {
  rentalId: string;
  user: string;
  amount: bigint;
  nonce: bigint;
}

/**
 * Event types emitted by the contract
 */
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

export interface RentalCreatedEvent {
  user: string;
  provider: string;
  rentalId: string;
  amount: bigint;
  vm: string;
  duration: bigint;
}

export interface RentalWithdrawnEvent {
  provider: string;
  rentalId: string;
  amount: bigint;
}

export interface RefundClaimedEvent {
  user: string;
  provider: string;
  rentalId: string;
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

export interface SignerAddedEvent {
  signer: string;
}

export interface SignerRemovedEvent {
  signer: string;
}

export interface RequiredRentalSignaturesUpdatedEvent {
  oldRequired: bigint;
  newRequired: bigint;
}

export interface RequiredWithdrawalSignaturesUpdatedEvent {
  oldRequired: bigint;
  newRequired: bigint;
}

export interface RequiredRefundSignaturesUpdatedEvent {
  oldRequired: bigint;
  newRequired: bigint;
}

export interface VmPriceUpdatedEvent {
  vm: string;
  oldPrice: bigint;
  newPrice: bigint;
}
