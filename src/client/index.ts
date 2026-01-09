// Main client classes
export { TLPStakingClient } from "./TLPStakingClient";
export { TLPStakingSigner } from "./TLPStakingSigner";

// Types
export type {
  ProviderInfo,
  Rental,
  TLPStakingDomain,
  RentalApprovalData,
  WithdrawalApprovalData,
  RefundApprovalData,
  StakedEvent,
  StakeExtendedEvent,
  StakeIncreasedEvent,
  StakeWithdrawnEvent,
  RentalCreatedEvent,
  RentalWithdrawnEvent,
  RefundClaimedEvent,
  ProviderSlashedEvent,
  ProviderUnbannedEvent,
  SignerAddedEvent,
  SignerRemovedEvent,
  RequiredRentalSignaturesUpdatedEvent,
  RequiredWithdrawalSignaturesUpdatedEvent,
  RequiredRefundSignaturesUpdatedEvent,
  VmPriceUpdatedEvent,
} from "./types";

export { EIP712_TYPES } from "./types";

// Constants
export {
  POLICE_ROLE,
  DEFAULT_ADMIN_ROLE,
  RENTAL_TYPEHASH,
  WITHDRAWAL_TYPEHASH,
  REFUND_TYPEHASH,
  MIN_STAKE_DURATION,
  ONE_DAY,
  ONE_HOUR,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
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
