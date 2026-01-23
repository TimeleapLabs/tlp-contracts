import type { Signer, TypedDataDomain } from "ethers";
import {
  EIP712_TYPES,
  TLPStakingDomain,
  WithdrawalData,
  ClaimData,
} from "./types";
import { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION } from "./constants";

/**
 * EIP712 signature helper for TLPStaking contract operations.
 * Used by authorized signers to approve withdrawals and claims.
 */
export class TLPStakingSigner {
  private readonly signer: Signer;
  private readonly contractAddress: string;
  private readonly chainId: bigint;

  /**
   * Create a new TLPStakingSigner instance
   * @param signer - Ethers.js signer that will sign the messages
   * @param contractAddress - Address of the TLPStaking contract
   * @param chainId - Chain ID for the network
   */
  constructor(signer: Signer, contractAddress: string, chainId: bigint) {
    this.signer = signer;
    this.contractAddress = contractAddress;
    this.chainId = chainId;
  }

  /**
   * Get the EIP712 domain for this contract
   */
  getDomain(): TLPStakingDomain {
    return {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: this.chainId,
      verifyingContract: this.contractAddress,
    };
  }

  /**
   * Get the signer's address
   */
  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  /**
   * Sign a withdrawal approval for user balance withdrawal
   * @param data - Withdrawal data
   * @returns EIP712 signature
   */
  async signWithdrawal(data: WithdrawalData): Promise<string> {
    const domain = this.getDomain();
    const types = { Withdrawal: EIP712_TYPES.Withdrawal };
    const value = {
      user: data.user,
      amount: data.amount,
      nonce: data.nonce,
      deadline: data.deadline,
    };

    return this.signer.signTypedData(
      domain as TypedDataDomain,
      types,
      value
    );
  }

  /**
   * Sign a claim approval for provider to claim from user balance
   * @param data - Claim data
   * @returns EIP712 signature
   */
  async signClaim(data: ClaimData): Promise<string> {
    const domain = this.getDomain();
    const types = { Claim: EIP712_TYPES.Claim };
    const value = {
      rentalId: data.rentalId,
      user: data.user,
      provider: data.provider,
      amount: data.amount,
      nonce: data.nonce,
      deadline: data.deadline,
    };

    return this.signer.signTypedData(
      domain as TypedDataDomain,
      types,
      value
    );
  }

  /**
   * Collect signatures from multiple signers for an operation
   * @param signers - Array of TLPStakingSigner instances
   * @param signFn - Function that takes a signer and returns a signature promise
   * @returns Array of signatures
   *
   * @example
   * ```typescript
   * const signatures = await TLPStakingSigner.collectSignatures(
   *   [signer1, signer2],
   *   (s) => s.signWithdrawal({ user, amount, nonce, deadline })
   * );
   * ```
   */
  static async collectSignatures(
    signers: TLPStakingSigner[],
    signFn: (signer: TLPStakingSigner) => Promise<string>
  ): Promise<string[]> {
    return Promise.all(signers.map(signFn));
  }

  /**
   * Create a TLPStakingSigner from a signer, fetching chainId from the provider
   * @param signer - Ethers.js signer
   * @param contractAddress - Address of the TLPStaking contract
   * @returns TLPStakingSigner instance
   */
  static async fromSigner(
    signer: Signer,
    contractAddress: string
  ): Promise<TLPStakingSigner> {
    const provider = signer.provider;
    if (!provider) {
      throw new Error("Signer must be connected to a provider");
    }
    const network = await provider.getNetwork();
    return new TLPStakingSigner(signer, contractAddress, network.chainId);
  }
}
