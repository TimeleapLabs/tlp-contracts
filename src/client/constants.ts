import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Access control role hashes
 */
export const POLICE_ROLE = keccak256(toUtf8Bytes("POLICE_ROLE"));
export const DEFAULT_ADMIN_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * EIP712 type hashes (must match contract)
 */
export const WITHDRAWAL_TYPEHASH = keccak256(
  toUtf8Bytes(
    "Withdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline)"
  )
);

export const CLAIM_TYPEHASH = keccak256(
  toUtf8Bytes(
    "Claim(bytes32 rentalId,address user,address provider,uint256 amount,uint256 nonce,uint256 deadline)"
  )
);

/**
 * Default durations in seconds
 */
export const MIN_STAKE_DURATION = 30 * 24 * 60 * 60; // 30 days
export const ONE_DAY = 24 * 60 * 60;
export const ONE_HOUR = 60 * 60;

/**
 * EIP712 domain name and version (must match contract)
 */
export const EIP712_DOMAIN_NAME = "TLPStaking";
export const EIP712_DOMAIN_VERSION = "1";

/**
 * Commission constants
 */
export const MAX_COMMISSION_BPS = 10000; // 100%
export const BPS_DENOMINATOR = 10000;
