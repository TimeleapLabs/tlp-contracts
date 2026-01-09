import { encodeBytes32String, decodeBytes32String, toUtf8String } from "ethers";

/**
 * Encode a VM identifier string to bytes32
 * @param name - VM type name (e.g., "vm.small", "vm.medium")
 * @returns bytes32 encoded string
 */
export function encodeVmId(name: string): string {
  if (name.length > 31) {
    throw new Error("VM identifier must be 31 characters or less");
  }
  return encodeBytes32String(name);
}

/**
 * Decode a bytes32 VM identifier to string
 * @param bytes32 - bytes32 encoded VM identifier
 * @returns Decoded string
 */
export function decodeVmId(bytes32: string): string {
  try {
    return decodeBytes32String(bytes32);
  } catch {
    // If decodeBytes32String fails, try to decode as UTF-8 and trim null bytes
    const hex = bytes32.startsWith("0x") ? bytes32.slice(2) : bytes32;
    const bytes = Buffer.from(hex, "hex");
    return toUtf8String(bytes).replace(/\0/g, "");
  }
}

/**
 * Format a duration in seconds to human-readable string
 * @param seconds - Duration in seconds (can be bigint or number)
 * @returns Formatted string (e.g., "30 days", "2 hours 30 minutes")
 */
export function formatDuration(seconds: bigint | number): string {
  const totalSeconds = typeof seconds === "bigint" ? Number(seconds) : seconds;

  if (totalSeconds < 0) {
    return "0 seconds";
  }

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} day${days !== 1 ? "s" : ""}`);
  }
  if (hours > 0) {
    parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
  }
  if (secs > 0 || parts.length === 0) {
    parts.push(`${secs} second${secs !== 1 ? "s" : ""}`);
  }

  return parts.join(" ");
}

/**
 * Calculate rental amount from price per second and duration
 * @param pricePerSecond - Price per second in wei
 * @param duration - Duration in seconds
 * @returns Total amount in wei
 */
export function calculateRentalAmount(
  pricePerSecond: bigint,
  duration: bigint
): bigint {
  return pricePerSecond * duration;
}

/**
 * Calculate unlock timestamp from current time and duration
 * @param durationSeconds - Duration in seconds
 * @returns Unix timestamp when stake will unlock
 */
export function calculateUnlockTime(durationSeconds: bigint | number): bigint {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const duration =
    typeof durationSeconds === "bigint"
      ? durationSeconds
      : BigInt(durationSeconds);
  return now + duration;
}

/**
 * Check if a stake is currently locked
 * @param unlockTime - Unix timestamp when stake unlocks
 * @returns true if stake is still locked
 */
export function isStakeLocked(unlockTime: bigint): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return now < unlockTime;
}

/**
 * Calculate time remaining until unlock
 * @param unlockTime - Unix timestamp when stake unlocks
 * @returns Seconds remaining (0 if already unlocked)
 */
export function timeUntilUnlock(unlockTime: bigint): bigint {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now >= unlockTime) {
    return BigInt(0);
  }
  return unlockTime - now;
}

/**
 * Convert duration to days
 * @param seconds - Duration in seconds
 * @returns Duration in days (as number with decimals)
 */
export function secondsToDays(seconds: bigint | number): number {
  const totalSeconds = typeof seconds === "bigint" ? Number(seconds) : seconds;
  return totalSeconds / 86400;
}

/**
 * Convert days to seconds
 * @param days - Duration in days
 * @returns Duration in seconds as bigint
 */
export function daysToSeconds(days: number): bigint {
  return BigInt(Math.floor(days * 86400));
}
