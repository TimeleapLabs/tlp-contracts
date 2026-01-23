import {
  Contract,
  Provider,
  Signer,
  ContractTransactionResponse,
  EventLog,
  Log,
} from "ethers";
import type { ProviderInfo, ClaimRequest, ClaimedEvent, DepositedEvent, WithdrawnEvent } from "./types";
import { TLPStakingSigner } from "./TLPStakingSigner";

// ABI for the TLPStaking contract (minimal interface for client operations)
const TLP_STAKING_ABI = [
  // Read functions
  "function tlpToken() view returns (address)",
  "function treasury() view returns (address)",
  "function minStakeDuration() view returns (uint256)",
  "function commissionBps() view returns (uint256)",
  "function providers(address) view returns (uint256 stakeAmount, uint256 unlockTime, bool isBanned, uint256 slashCount)",
  "function userBalances(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function isSigner(address) view returns (bool)",
  "function signers(uint256) view returns (address)",
  "function requiredSignatures() view returns (uint256)",
  "function getProviderInfo(address) view returns (uint256 stakeAmount, uint256 unlockTime, bool isBanned, uint256 slashCount)",
  "function getUserBalance(address) view returns (uint256)",
  "function getNonce(address) view returns (uint256)",
  "function isProviderActive(address) view returns (bool)",
  "function getSigners() view returns (address[])",
  "function getSignerCount() view returns (uint256)",
  "function domainSeparator() view returns (bytes32)",
  "function hasRole(bytes32, address) view returns (bool)",
  "function getRoleAdmin(bytes32) view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function POLICE_ROLE() view returns (bytes32)",

  // Write functions - User Balance
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount, uint256 deadline, bytes[] signatures)",

  // Write functions - Provider Claim
  "function claim(bytes32 rentalId, address user, uint256 amount, uint256 deadline, bytes[] signatures)",
  "function batchClaim(tuple(bytes32 rentalId, address user, uint256 amount, uint256 deadline)[] claims, bytes[][] signatures)",

  // Write functions - Provider Staking
  "function stake(uint256 amount, uint256 duration)",
  "function extendStakeDuration(uint256 newUnlockTime)",
  "function increaseStake(uint256 amount)",
  "function withdrawStake()",

  // Admin functions
  "function addSigner(address signer)",
  "function removeSigner(address signer)",
  "function setRequiredSignatures(uint256 _required)",
  "function setMinStakeDuration(uint256 newDuration)",
  "function setTreasury(address newTreasury)",
  "function setCommission(uint256 newCommissionBps)",
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
  "event Deposited(address indexed user, uint256 amount, uint256 newBalance)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 newBalance)",
  "event Claimed(bytes32 indexed rentalId, address indexed user, address indexed provider, uint256 amount, uint256 commission)",
  "event ProviderSlashed(address indexed provider, uint256 slashedStake, bool banned)",
  "event ProviderUnbanned(address indexed provider)",
  "event SignerAdded(address indexed signer)",
  "event SignerRemoved(address indexed signer)",
  "event RequiredSignaturesUpdated(uint256 oldRequired, uint256 newRequired)",
  "event CommissionUpdated(uint256 oldCommission, uint256 newCommission)",
  "event TreasuryUpdated(address oldTreasury, address newTreasury)",
  "event MinStakeDurationUpdated(uint256 oldDuration, uint256 newDuration)",
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

  // ============ Read Methods - User Balance ============

  /**
   * Get user's balance in the pool
   * @param user - User address
   */
  async getUserBalance(user: string): Promise<bigint> {
    return this.contract.getUserBalance(user);
  }

  /**
   * Get current nonce for an address
   * @param account - Account address
   */
  async getNonce(account: string): Promise<bigint> {
    return this.contract.getNonce(account);
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
   * Get number of required signatures
   */
  async getRequiredSignatures(): Promise<bigint> {
    return this.contract.requiredSignatures();
  }

  // ============ Read Methods - Config ============

  /**
   * Get minimum stake duration
   */
  async getMinStakeDuration(): Promise<bigint> {
    return this.contract.minStakeDuration();
  }

  /**
   * Get commission rate in basis points
   */
  async getCommissionBps(): Promise<bigint> {
    return this.contract.commissionBps();
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

  // ============ Write Methods - User Balance ============

  /**
   * Deposit tokens to user's balance in the pool
   * @param amount - Amount of tokens to deposit
   */
  async deposit(amount: bigint): Promise<ContractTransactionResponse> {
    return this.contract.deposit(amount);
  }

  /**
   * Withdraw tokens from user's balance (requires k-of-n signatures)
   * @param amount - Amount to withdraw
   * @param deadline - Signature expiration timestamp
   * @param signatures - Array of EIP712 signatures from authorized signers
   */
  async withdraw(
    amount: bigint,
    deadline: bigint,
    signatures: string[]
  ): Promise<ContractTransactionResponse> {
    return this.contract.withdraw(amount, deadline, signatures);
  }

  // ============ Write Methods - Provider Claim ============

  /**
   * Provider claims from a user's balance (requires k-of-n signatures)
   * @param rentalId - Rental ID for audit trail (bytes32)
   * @param user - Address of the user to claim from
   * @param amount - Amount to claim
   * @param deadline - Signature expiration timestamp
   * @param signatures - Array of EIP712 signatures from authorized signers
   */
  async claim(
    rentalId: string,
    user: string,
    amount: bigint,
    deadline: bigint,
    signatures: string[]
  ): Promise<ContractTransactionResponse> {
    return this.contract.claim(rentalId, user, amount, deadline, signatures);
  }

  /**
   * Provider claims from multiple users in a single transaction
   * @param claims - Array of claim requests
   * @param signatures - Array of signature arrays for each claim
   */
  async batchClaim(
    claims: ClaimRequest[],
    signatures: string[][]
  ): Promise<ContractTransactionResponse> {
    return this.contract.batchClaim(claims, signatures);
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
   * Set the number of required signatures
   * @param k - Number of required signatures
   */
  async setRequiredSignatures(k: bigint): Promise<ContractTransactionResponse> {
    return this.contract.setRequiredSignatures(k);
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
   * Update treasury address
   * @param treasury - New treasury address
   */
  async setTreasury(treasury: string): Promise<ContractTransactionResponse> {
    return this.contract.setTreasury(treasury);
  }

  /**
   * Set commission rate for provider claims
   * @param commissionBps - Commission in basis points (10000 = 100%)
   */
  async setCommission(
    commissionBps: bigint
  ): Promise<ContractTransactionResponse> {
    return this.contract.setCommission(commissionBps);
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
   * Parse Deposited event from transaction receipt
   * @param logs - Transaction logs
   * @returns Deposited event data or null if not found
   */
  parseDepositedEvent(logs: (Log | EventLog)[]): DepositedEvent | null {
    for (const log of logs) {
      try {
        const parsed = this.contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === "Deposited") {
          return {
            user: parsed.args[0],
            amount: parsed.args[1],
            newBalance: parsed.args[2],
          };
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Parse Withdrawn event from transaction receipt
   * @param logs - Transaction logs
   * @returns Withdrawn event data or null if not found
   */
  parseWithdrawnEvent(logs: (Log | EventLog)[]): WithdrawnEvent | null {
    for (const log of logs) {
      try {
        const parsed = this.contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === "Withdrawn") {
          return {
            user: parsed.args[0],
            amount: parsed.args[1],
            newBalance: parsed.args[2],
          };
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Parse Claimed event from transaction receipt
   * @param logs - Transaction logs
   * @returns Claimed event data or null if not found
   */
  parseClaimedEvent(logs: (Log | EventLog)[]): ClaimedEvent | null {
    for (const log of logs) {
      try {
        const parsed = this.contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === "Claimed") {
          return {
            rentalId: parsed.args[0],
            user: parsed.args[1],
            provider: parsed.args[2],
            amount: parsed.args[3],
            commission: parsed.args[4],
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
