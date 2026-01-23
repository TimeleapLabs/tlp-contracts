// Main client classes
export { TLPStakingClient } from "./TLPStakingClient";
export { TLPStakingSigner } from "./TLPStakingSigner";

// Types
export type {
  ProviderInfo,
  ClaimRequest,
  TLPStakingDomain,
  WithdrawalData,
  ClaimData,
  StakedEvent,
  StakeExtendedEvent,
  StakeIncreasedEvent,
  StakeWithdrawnEvent,
  ProviderSlashedEvent,
  ProviderUnbannedEvent,
  DepositedEvent,
  WithdrawnEvent,
  ClaimedEvent,
  SignerAddedEvent,
  SignerRemovedEvent,
  RequiredSignaturesUpdatedEvent,
  CommissionUpdatedEvent,
  TreasuryUpdatedEvent,
  MinStakeDurationUpdatedEvent,
} from "./types";

export { EIP712_TYPES } from "./types";

// Constants
export {
  POLICE_ROLE,
  DEFAULT_ADMIN_ROLE,
  WITHDRAWAL_TYPEHASH,
  CLAIM_TYPEHASH,
  MIN_STAKE_DURATION,
  ONE_DAY,
  ONE_HOUR,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  MAX_COMMISSION_BPS,
  BPS_DENOMINATOR,
} from "./constants";

// Utilities
export {
  encodeVmId,
  decodeVmId,
  formatDuration,
  calculateRentalAmount,
  calculateUnlockTime,
  isStakeLocked,
  timeUntilUnlock,
  secondsToDays,
  daysToSeconds,
} from "./utils";
