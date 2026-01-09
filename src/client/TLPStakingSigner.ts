import type { Signer, TypedDataDomain } from "ethers";
import {
  EIP712_TYPES,
  TLPStakingDomain,
  RentalApprovalData,
  WithdrawalApprovalData,
  RefundApprovalData,
} from "./types";
import { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION } from "./constants";

/**
 * EIP712 signature helper for TLPStaking contract operations.
 * Used by authorized signers to approve rentals, withdrawals, and refunds.
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
   * Sign a rental approval for rentFromProvider
   * @param data - Rental approval data
   * @returns EIP712 signature
   */
  async signRentalApproval(data: RentalApprovalData): Promise<string> {
    const domain = this.getDomain();
    const types = { RentalApproval: EIP712_TYPES.RentalApproval };
    const value = {
      rentalId: data.rentalId,
      user: data.user,
      provider: data.provider,
      vm: data.vm,
      duration: data.duration,
      nonce: data.nonce,
    };

    return this.signer.signTypedData(
      domain as TypedDataDomain,
      types,
      value
    );
  }

  /**
   * Sign a withdrawal approval for withdrawRental
   * @param data - Withdrawal approval data
   * @returns EIP712 signature
   */
  async signWithdrawalApproval(data: WithdrawalApprovalData): Promise<string> {
    const domain = this.getDomain();
    const types = { WithdrawalApproval: EIP712_TYPES.WithdrawalApproval };
    const value = {
      rentalId: data.rentalId,
      provider: data.provider,
      amount: data.amount,
      nonce: data.nonce,
    };

    return this.signer.signTypedData(
      domain as TypedDataDomain,
      types,
      value
    );
  }

  /**
   * Sign a refund approval for claimRefund
   * @param data - Refund approval data
   * @returns EIP712 signature
   */
  async signRefundApproval(data: RefundApprovalData): Promise<string> {
    const domain = this.getDomain();
    const types = { RefundApproval: EIP712_TYPES.RefundApproval };
    const value = {
      rentalId: data.rentalId,
      user: data.user,
      amount: data.amount,
      nonce: data.nonce,
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
   *   (s) => s.signPaymentApproval({ user, provider, vm, duration, nonce })
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
