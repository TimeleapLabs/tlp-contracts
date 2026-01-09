import {
  Contract,
  Provider,
  Signer,
  ContractTransactionResponse,
  EventLog,
  Log,
} from "ethers";
import type { ProviderInfo, Rental, RentalCreatedEvent } from "./types";
import { TLPStakingSigner } from "./TLPStakingSigner";

// ABI for the TLPStaking contract (minimal interface for client operations)
const TLP_STAKING_ABI = [
  // Read functions
  "function tlpToken() view returns (address)",
  "function treasury() view returns (address)",
  "function minStakeDuration() view returns (uint256)",
  "function rentalGracePeriod() view returns (uint256)",
  "function providers(address) view returns (uint256 stakeAmount, uint256 unlockTime, bool isBanned, uint256 slashCount)",
  "function vmPricePerSecond(bytes32) view returns (uint256)",
  "function rentals(bytes32) view returns (address user, address provider, uint256 amount, uint256 timestamp, bytes32 vm, uint256 duration, uint256 withdrawnAmount, uint256 refundedAmount)",
  "function userRentals(address, uint256) view returns (bytes32)",
  "function providerRentals(address, uint256) view returns (bytes32)",
  "function isSigner(address) view returns (bool)",
  "function signers(uint256) view returns (address)",
  "function requiredRentalSignatures() view returns (uint256)",
  "function requiredWithdrawalSignatures() view returns (uint256)",
  "function requiredRefundSignatures() view returns (uint256)",
  "function rentalNonces(address) view returns (uint256)",
  "function withdrawalNonces(bytes32) view returns (uint256)",
  "function refundNonces(bytes32) view returns (uint256)",
  "function getProviderInfo(address) view returns (uint256 stakeAmount, uint256 unlockTime, bool isBanned, uint256 slashCount)",
  "function getRental(bytes32) view returns (tuple(address user, address provider, uint256 amount, uint256 timestamp, bytes32 vm, uint256 duration, uint256 withdrawnAmount, uint256 refundedAmount))",
  "function getUserRentals(address) view returns (bytes32[])",
  "function getProviderRentals(address) view returns (bytes32[])",
  "function isProviderActive(address) view returns (bool)",
  "function getSigners() view returns (address[])",
  "function getSignerCount() view returns (uint256)",
  "function domainSeparator() view returns (bytes32)",
  "function hasRole(bytes32, address) view returns (bool)",
  "function getRoleAdmin(bytes32) view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function POLICE_ROLE() view returns (bytes32)",

  // Write functions - Provider
  "function stake(uint256 amount, uint256 duration)",
  "function extendStakeDuration(uint256 newUnlockTime)",
  "function increaseStake(uint256 amount)",
  "function withdrawStake()",

  // Write functions - User
  "function rentFromProvider(bytes32 rentalId, address provider, bytes32 vm, uint256 duration, bytes[] signatures)",
  "function claimRefund(bytes32 rentalId, uint256 amount, bytes[] signatures)",

  // Write functions - Provider withdrawal
  "function withdrawRental(bytes32 rentalId, uint256 amount, bytes[] signatures)",
  "function batchWithdrawRental(bytes32[] rentalIds, uint256[] amounts, bytes[][] signatures)",

  // Admin functions
  "function addSigner(address signer)",
  "function removeSigner(address signer)",
  "function setRequiredRentalSignatures(uint256 _required)",
  "function setRequiredWithdrawalSignatures(uint256 _required)",
  "function setRequiredRefundSignatures(uint256 _required)",
  "function setMinStakeDuration(uint256 newDuration)",
  "function setRentalGracePeriod(uint256 newPeriod)",
  "function setTreasury(address newTreasury)",
  "function setVmPrice(bytes32 vm, uint256 pricePerSecond)",
  "function grantRole(bytes32 role, address account)",
  "function revokeRole(bytes32 role, address account)",

  // Police functions
  "function slashAndBan(address provider)",
  "function slashPartial(address provider, uint256 slashAmount)",
  "function unbanProvider(address provider)",

  // Events
  "event Staked(address indexed provider, uint256 amount, uint256 unlockTime)",
  "event StakeExtended(address indexed provider, uint256 newUnlockTime)",
  "event StakeIncreased(address indexed provider, uint256 addedAmount, uint256 newTotal, uint256 newUnlockTime)",
  "event StakeWithdrawn(address indexed provider, uint256 amount)",
  "event RentalCreated(address indexed user, address indexed provider, bytes32 indexed rentalId, uint256 amount, bytes32 vm, uint256 duration)",
  "event RentalWithdrawn(address indexed provider, bytes32 indexed rentalId, uint256 amount)",
  "event RefundClaimed(address indexed user, address indexed provider, bytes32 indexed rentalId, uint256 amount)",
  "event ProviderSlashed(address indexed provider, uint256 slashedStake, bool banned)",
  "event ProviderUnbanned(address indexed provider)",
  "event SignerAdded(address indexed signer)",
  "event SignerRemoved(address indexed signer)",
  "event RequiredRentalSignaturesUpdated(uint256 oldRequired, uint256 newRequired)",
  "event RequiredWithdrawalSignaturesUpdated(uint256 oldRequired, uint256 newRequired)",
  "event RequiredRefundSignaturesUpdated(uint256 oldRequired, uint256 newRequired)",
  "event VmPriceUpdated(bytes32 indexed vm, uint256 oldPrice, uint256 newPrice)",
  "event RentalGracePeriodUpdated(uint256 oldPeriod, uint256 newPeriod)",
];

/**
 * Client for interacting with the TLPStaking contract.
 * Provides type-safe methods for all contract operations.
 */
export class TLPStakingClient {
  private readonly contract: Contract;
  private readonly address: string;
  private chainId: bigint | null = null;

  /**
   * Create a new TLPStakingClient
   * @param providerOrSigner - Ethers.js provider or signer
   * @param contractAddress - Address of the deployed TLPStaking contract
   */
  constructor(
    providerOrSigner: Provider | Signer,
    contractAddress: string
  ) {
    this.contract = new Contract(
      contractAddress,
      TLP_STAKING_ABI,
      providerOrSigner
    );
    this.address = contractAddress;
  }

  /**
   * Get the contract address
   */
  getAddress(): string {
    return this.address;
  }

  /**
   * Get the underlying contract instance
   */
  getContract(): Contract {
    return this.contract;
  }

  /**
   * Get the chain ID (cached after first call)
   */
  async getChainId(): Promise<bigint> {
    if (this.chainId === null) {
      const provider = this.contract.runner?.provider;
      if (!provider) {
        throw new Error("No provider available");
      }
      const network = await provider.getNetwork();
      this.chainId = network.chainId;
    }
    return this.chainId;
  }

  /**
   * Create a TLPStakingSigner for this contract
   * @param signer - Ethers.js signer
   */
  async createSigner(signer: Signer): Promise<TLPStakingSigner> {
    const chainId = await this.getChainId();
    return new TLPStakingSigner(signer, this.address, chainId);
  }

  // ============ Read Methods - Provider ============

  /**
   * Get provider staking information
   * @param provider - Provider address
   */
  async getProviderInfo(provider: string): Promise<ProviderInfo> {
    const [stakeAmount, unlockTime, isBanned, slashCount] =
      await this.contract.getProviderInfo(provider);
    return { stakeAmount, unlockTime, isBanned, slashCount };
  }

  /**
   * Check if a provider is active (staked and not banned)
   * @param provider - Provider address
   */
  async isProviderActive(provider: string): Promise<boolean> {
    return this.contract.isProviderActive(provider);
  }

  // ============ Read Methods - Rentals ============

  /**
   * Get rental details by ID
   * @param rentalId - Rental ID (bytes32)
   */
  async getRental(rentalId: string): Promise<Rental> {
    const result = await this.contract.getRental(rentalId);
    return {
      user: result.user,
      provider: result.provider,
      amount: result.amount,
      timestamp: result.timestamp,
      vm: result.vm,
      duration: result.duration,
      withdrawnAmount: result.withdrawnAmount,
      refundedAmount: result.refundedAmount,
    };
  }

  /**
   * Get all rental IDs for a user
   * @param user - User address
   */
  async getUserRentals(user: string): Promise<string[]> {
    return this.contract.getUserRentals(user);
  }

  /**
   * Get all rental IDs received by a provider
   * @param provider - Provider address
   */
  async getProviderRentals(provider: string): Promise<string[]> {
    return this.contract.getProviderRentals(provider);
  }

  // ============ Read Methods - VM Pricing ============

  /**
   * Get price per second for a VM type
   * @param vm - VM type identifier (bytes32)
   */
  async getVmPrice(vm: string): Promise<bigint> {
    return this.contract.vmPricePerSecond(vm);
  }

  /**
   * Calculate rental amount for a VM rental
   * @param vm - VM type identifier (bytes32)
   * @param duration - Duration in seconds
   */
  async calculateRentalAmount(vm: string, duration: bigint): Promise<bigint> {
    const pricePerSecond = await this.getVmPrice(vm);
    return pricePerSecond * duration;
  }

  // ============ Read Methods - Signers ============

  /**
   * Get all authorized signers
   */
  async getSigners(): Promise<string[]> {
    return this.contract.getSigners();
  }

  /**
   * Get number of authorized signers
   */
  async getSignerCount(): Promise<bigint> {
    return this.contract.getSignerCount();
  }

  /**
   * Check if an address is an authorized signer
   * @param address - Address to check
   */
  async isSigner(address: string): Promise<boolean> {
    return this.contract.isSigner(address);
  }

  /**
   * Get number of required signatures for rentals
   */
  async getRequiredRentalSignatures(): Promise<bigint> {
    return this.contract.requiredRentalSignatures();
  }

  /**
   * Get number of required signatures for withdrawals
   */
  async getRequiredWithdrawalSignatures(): Promise<bigint> {
    return this.contract.requiredWithdrawalSignatures();
  }

  /**
   * Get number of required signatures for refunds
   */
  async getRequiredRefundSignatures(): Promise<bigint> {
    return this.contract.requiredRefundSignatures();
  }

  // ============ Read Methods - Nonces ============

  /**
   * Get rental nonce for a user
   * @param user - User address
   */
  async getRentalNonce(user: string): Promise<bigint> {
    return this.contract.rentalNonces(user);
  }

  /**
   * Get withdrawal nonce for a rental
   * @param rentalId - Rental ID (bytes32)
   */
  async getWithdrawalNonce(rentalId: string): Promise<bigint> {
    return this.contract.withdrawalNonces(rentalId);
  }

  /**
   * Get refund nonce for a rental
   * @param rentalId - Rental ID (bytes32)
   */
  async getRefundNonce(rentalId: string): Promise<bigint> {
    return this.contract.refundNonces(rentalId);
  }

  // ============ Read Methods - Config ============

  /**
   * Get minimum stake duration
   */
  async getMinStakeDuration(): Promise<bigint> {
    return this.contract.minStakeDuration();
  }

  /**
   * Get rental grace period
   */
  async getRentalGracePeriod(): Promise<bigint> {
    return this.contract.rentalGracePeriod();
  }

  /**
   * Get treasury address
   */
  async getTreasury(): Promise<string> {
    return this.contract.treasury();
  }

  /**
   * Get TLP token address
   */
  async getTlpToken(): Promise<string> {
    return this.contract.tlpToken();
  }

  /**
   * Get EIP712 domain separator
   */
  async getDomainSeparator(): Promise<string> {
    return this.contract.domainSeparator();
  }

  // ============ Read Methods - Access Control ============

  /**
   * Check if an account has a role
   * @param role - Role hash
   * @param account - Account address
   */
  async hasRole(role: string, account: string): Promise<boolean> {
    return this.contract.hasRole(role, account);
  }

  /**
   * Get the POLICE_ROLE hash
   */
  async getPoliceRole(): Promise<string> {
    return this.contract.POLICE_ROLE();
  }

  /**
   * Get the DEFAULT_ADMIN_ROLE hash
   */
  async getDefaultAdminRole(): Promise<string> {
    return this.contract.DEFAULT_ADMIN_ROLE();
  }

  // ============ Write Methods - Provider Staking ============

  /**
   * Stake tokens as a provider
   * @param amount - Amount of tokens to stake
   * @param duration - Duration to lock the stake (in seconds)
   */
  async stake(
    amount: bigint,
    duration: bigint
  ): Promise<ContractTransactionResponse> {
    return this.contract.stake(amount, duration);
  }

  /**
   * Extend stake lock duration
   * @param newUnlockTime - New unlock timestamp
   */
  async extendStakeDuration(
    newUnlockTime: bigint
  ): Promise<ContractTransactionResponse> {
    return this.contract.extendStakeDuration(newUnlockTime);
  }

  /**
   * Add more tokens to existing stake
   * @param amount - Amount of tokens to add
   */
  async increaseStake(amount: bigint): Promise<ContractTransactionResponse> {
    return this.contract.increaseStake(amount);
  }

  /**
   * Withdraw stake after unlock time
   */
  async withdrawStake(): Promise<ContractTransactionResponse> {
    return this.contract.withdrawStake();
  }

  // ============ Write Methods - User Rentals ============

  /**
   * Rent VM resources from a provider
   * @param rentalId - Unique rental ID (bytes32, generated by backend)
   * @param provider - Provider address
   * @param vm - VM type identifier (bytes32)
   * @param duration - Duration in seconds
   * @param signatures - Array of EIP712 signatures from authorized signers
   */
  async rentFromProvider(
    rentalId: string,
    provider: string,
    vm: string,
    duration: bigint,
    signatures: string[]
  ): Promise<ContractTransactionResponse> {
    return this.contract.rentFromProvider(rentalId, provider, vm, duration, signatures);
  }

  /**
   * Claim refund for a rental
   * @param rentalId - Rental ID (bytes32)
   * @param amount - Amount to refund (must match signed amount)
   * @param signatures - Array of EIP712 signatures from authorized signers
   */
  async claimRefund(
    rentalId: string,
    amount: bigint,
    signatures: string[]
  ): Promise<ContractTransactionResponse> {
    return this.contract.claimRefund(rentalId, amount, signatures);
  }

  // ============ Write Methods - Provider Withdrawal ============

  /**
   * Withdraw rental proceeds (as provider)
   * @param rentalId - Rental ID (bytes32)
   * @param amount - Amount to withdraw (must match signed amount)
   * @param signatures - Array of EIP712 signatures from authorized signers
   */
  async withdrawRental(
    rentalId: string,
    amount: bigint,
    signatures: string[]
  ): Promise<ContractTransactionResponse> {
    return this.contract.withdrawRental(rentalId, amount, signatures);
  }

  /**
   * Batch withdraw from multiple rentals in a single transaction
   * @param rentalIds - Array of rental IDs (bytes32)
   * @param amounts - Array of amounts to withdraw from each rental
   * @param signatures - Array of signature arrays for each withdrawal
   */
  async batchWithdrawRental(
    rentalIds: string[],
    amounts: bigint[],
    signatures: string[][]
  ): Promise<ContractTransactionResponse> {
    return this.contract.batchWithdrawRental(rentalIds, amounts, signatures);
  }

  // ============ Admin Methods ============

  /**
   * Add an authorized signer
   * @param signer - Signer address to add
   */
  async addSigner(signer: string): Promise<ContractTransactionResponse> {
    return this.contract.addSigner(signer);
  }

  /**
   * Remove an authorized signer
   * @param signer - Signer address to remove
   */
  async removeSigner(signer: string): Promise<ContractTransactionResponse> {
    return this.contract.removeSigner(signer);
  }

  /**
   * Set the number of required signatures for rentals
   * @param k - Number of required signatures
   */
  async setRequiredRentalSignatures(k: bigint): Promise<ContractTransactionResponse> {
    return this.contract.setRequiredRentalSignatures(k);
  }

  /**
   * Set the number of required signatures for withdrawals
   * @param k - Number of required signatures
   */
  async setRequiredWithdrawalSignatures(k: bigint): Promise<ContractTransactionResponse> {
    return this.contract.setRequiredWithdrawalSignatures(k);
  }

  /**
   * Set the number of required signatures for refunds
   * @param k - Number of required signatures
   */
  async setRequiredRefundSignatures(k: bigint): Promise<ContractTransactionResponse> {
    return this.contract.setRequiredRefundSignatures(k);
  }

  /**
   * Update minimum stake duration
   * @param duration - New minimum duration in seconds
   */
  async setMinStakeDuration(
    duration: bigint
  ): Promise<ContractTransactionResponse> {
    return this.contract.setMinStakeDuration(duration);
  }

  /**
   * Update rental grace period
   * @param period - New grace period in seconds
   */
  async setRentalGracePeriod(
    period: bigint
  ): Promise<ContractTransactionResponse> {
    return this.contract.setRentalGracePeriod(period);
  }

  /**
   * Update treasury address
   * @param treasury - New treasury address
   */
  async setTreasury(treasury: string): Promise<ContractTransactionResponse> {
    return this.contract.setTreasury(treasury);
  }

  /**
   * Set price per second for a VM type
   * @param vm - VM type identifier (bytes32)
   * @param pricePerSecond - Price per second in wei
   */
  async setVmPrice(
    vm: string,
    pricePerSecond: bigint
  ): Promise<ContractTransactionResponse> {
    return this.contract.setVmPrice(vm, pricePerSecond);
  }

  /**
   * Grant a role to an account
   * @param role - Role hash
   * @param account - Account address
   */
  async grantRole(
    role: string,
    account: string
  ): Promise<ContractTransactionResponse> {
    return this.contract.grantRole(role, account);
  }

  /**
   * Revoke a role from an account
   * @param role - Role hash
   * @param account - Account address
   */
  async revokeRole(
    role: string,
    account: string
  ): Promise<ContractTransactionResponse> {
    return this.contract.revokeRole(role, account);
  }

  // ============ Police Methods ============

  /**
   * Slash and ban: Remove all stake and ban provider
   * @param provider - Provider address
   */
  async slashAndBan(provider: string): Promise<ContractTransactionResponse> {
    return this.contract.slashAndBan(provider);
  }

  /**
   * Slash partial stake without banning
   * @param provider - Provider address
   * @param slashAmount - Amount to slash
   */
  async slashPartial(
    provider: string,
    slashAmount: bigint
  ): Promise<ContractTransactionResponse> {
    return this.contract.slashPartial(provider, slashAmount);
  }

  /**
   * Unban a previously banned provider
   * @param provider - Provider address
   */
  async unbanProvider(provider: string): Promise<ContractTransactionResponse> {
    return this.contract.unbanProvider(provider);
  }

  // ============ Event Parsing Helpers ============

  /**
   * Parse RentalCreated event from transaction receipt
   * @param logs - Transaction logs
   * @returns RentalCreated event data or null if not found
   */
  parseRentalCreatedEvent(
    logs: (Log | EventLog)[]
  ): RentalCreatedEvent | null {
    for (const log of logs) {
      try {
        const parsed = this.contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === "RentalCreated") {
          return {
            user: parsed.args[0],
            provider: parsed.args[1],
            rentalId: parsed.args[2],
            amount: parsed.args[3],
            vm: parsed.args[4],
            duration: parsed.args[5],
          };
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Connect to a different provider or signer
   * @param providerOrSigner - New provider or signer
   * @returns New TLPStakingClient instance
   */
  connect(providerOrSigner: Provider | Signer): TLPStakingClient {
    return new TLPStakingClient(providerOrSigner, this.address);
  }
}
