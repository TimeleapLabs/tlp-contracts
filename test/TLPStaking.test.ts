import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TLPStaking, Timeleap } from "../typechain-types";

describe("TLPStaking", function () {
  let tlpToken: Timeleap;
  let staking: TLPStaking;
  let admin: HardhatEthersSigner;
  let police: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let provider1: HardhatEthersSigner;
  let provider2: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let signer1: HardhatEthersSigner;
  let signer2: HardhatEthersSigner;
  let signer3: HardhatEthersSigner;

  const STAKE_AMOUNT = ethers.parseEther("10000");
  const DEPOSIT_AMOUNT = ethers.parseEther("1000");
  const MIN_STAKE_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds

  const POLICE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("POLICE_ROLE"));
  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Helper function to create EIP712 domain
  async function getDomain() {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    return {
      name: "TLPStaking",
      version: "1",
      chainId: chainId,
      verifyingContract: await staking.getAddress()
    };
  }

  // Helper to generate unique rental IDs (for audit trail)
  let rentalIdCounter = 0n;
  function generateRentalId(): string {
    rentalIdCounter++;
    return ethers.zeroPadValue(ethers.toBeHex(rentalIdCounter), 32);
  }

  // Helper function to get deadline (1 hour from now by default)
  async function getDeadline(offsetSeconds: number = 3600): Promise<bigint> {
    const timestamp = await time.latest();
    return BigInt(timestamp + offsetSeconds);
  }

  // Helper function to sign withdrawal
  async function signWithdrawal(
    signersList: HardhatEthersSigner[],
    user: string,
    amount: bigint,
    nonce: bigint,
    deadline: bigint
  ): Promise<string[]> {
    const domain = await getDomain();
    const types = {
      Withdrawal: [
        { name: "user", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    };
    const value = { user, amount, nonce, deadline };

    const signatures: string[] = [];
    for (const signer of signersList) {
      const signature = await signer.signTypedData(domain, types, value);
      signatures.push(signature);
    }
    return signatures;
  }

  // Helper function to sign claim
  async function signClaim(
    signersList: HardhatEthersSigner[],
    rentalId: string,
    user: string,
    provider: string,
    amount: bigint,
    nonce: bigint,
    deadline: bigint
  ): Promise<string[]> {
    const domain = await getDomain();
    const types = {
      Claim: [
        { name: "rentalId", type: "bytes32" },
        { name: "user", type: "address" },
        { name: "provider", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    };
    const value = { rentalId, user, provider, amount, nonce, deadline };

    const signatures: string[] = [];
    for (const signer of signersList) {
      const signature = await signer.signTypedData(domain, types, value);
      signatures.push(signature);
    }
    return signatures;
  }

  beforeEach(async function () {
    [admin, police, treasury, provider1, provider2, user1, user2, signer1, signer2, signer3] = await ethers.getSigners();

    // Deploy TLP token
    const TimeleapFactory = await ethers.getContractFactory("Timeleap");
    tlpToken = await TimeleapFactory.deploy(admin.address);
    await tlpToken.waitForDeployment();

    // Deploy staking contract
    const StakingFactory = await ethers.getContractFactory("TLPStaking");
    staking = await StakingFactory.deploy(
      await tlpToken.getAddress(),
      treasury.address,
      admin.address
    );
    await staking.waitForDeployment();

    // Grant police role
    await staking.connect(admin).grantRole(POLICE_ROLE, police.address);

    // Add signers and set required signatures
    await staking.connect(admin).addSigner(signer1.address);
    await staking.connect(admin).addSigner(signer2.address);
    await staking.connect(admin).addSigner(signer3.address);
    await staking.connect(admin).setRequiredSignatures(2);

    // Distribute tokens for testing
    await tlpToken.connect(admin).transfer(provider1.address, ethers.parseEther("100000"));
    await tlpToken.connect(admin).transfer(provider2.address, ethers.parseEther("100000"));
    await tlpToken.connect(admin).transfer(user1.address, ethers.parseEther("100000"));
    await tlpToken.connect(admin).transfer(user2.address, ethers.parseEther("100000"));

    // Approve staking contract
    await tlpToken.connect(provider1).approve(await staking.getAddress(), ethers.MaxUint256);
    await tlpToken.connect(provider2).approve(await staking.getAddress(), ethers.MaxUint256);
    await tlpToken.connect(user1).approve(await staking.getAddress(), ethers.MaxUint256);
    await tlpToken.connect(user2).approve(await staking.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("should set correct initial values", async function () {
      expect(await staking.tlpToken()).to.equal(await tlpToken.getAddress());
      expect(await staking.treasury()).to.equal(treasury.address);
      expect(await staking.minStakeDuration()).to.equal(MIN_STAKE_DURATION);
      expect(await staking.requiredSignatures()).to.equal(2);
      expect(await staking.commissionBps()).to.equal(0);
    });

    it("should grant roles correctly", async function () {
      expect(await staking.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await staking.hasRole(POLICE_ROLE, admin.address)).to.be.true;
      expect(await staking.hasRole(POLICE_ROLE, police.address)).to.be.true;
    });

    it("should revert with zero addresses", async function () {
      const StakingFactory = await ethers.getContractFactory("TLPStaking");

      await expect(
        StakingFactory.deploy(ethers.ZeroAddress, treasury.address, admin.address)
      ).to.be.revertedWithCustomError(staking, "ZeroAddress");

      await expect(
        StakingFactory.deploy(await tlpToken.getAddress(), ethers.ZeroAddress, admin.address)
      ).to.be.revertedWithCustomError(staking, "ZeroAddress");

      await expect(
        StakingFactory.deploy(await tlpToken.getAddress(), treasury.address, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(staking, "ZeroAddress");
    });
  });

  describe("Signer Management", function () {
    it("should add signers correctly", async function () {
      expect(await staking.isSigner(signer1.address)).to.be.true;
      expect(await staking.isSigner(signer2.address)).to.be.true;
      expect(await staking.isSigner(signer3.address)).to.be.true;
      expect(await staking.getSignerCount()).to.equal(3);
    });

    it("should emit SignerAdded event", async function () {
      const newSigner = user1;
      await expect(staking.connect(admin).addSigner(newSigner.address))
        .to.emit(staking, "SignerAdded")
        .withArgs(newSigner.address);
    });

    it("should reject adding zero address as signer", async function () {
      await expect(
        staking.connect(admin).addSigner(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(staking, "ZeroAddress");
    });

    it("should reject adding duplicate signer", async function () {
      await expect(
        staking.connect(admin).addSigner(signer1.address)
      ).to.be.revertedWithCustomError(staking, "SignerAlreadyAuthorized");
    });

    it("should remove signer correctly", async function () {
      await expect(staking.connect(admin).removeSigner(signer3.address))
        .to.emit(staking, "SignerRemoved")
        .withArgs(signer3.address);

      expect(await staking.isSigner(signer3.address)).to.be.false;
      expect(await staking.getSignerCount()).to.equal(2);
    });

    it("should adjust requiredSignatures when removing signer below threshold", async function () {
      await staking.connect(admin).removeSigner(signer3.address);
      await staking.connect(admin).removeSigner(signer2.address);
      expect(await staking.requiredSignatures()).to.equal(1);
    });

    it("should set required signatures", async function () {
      await expect(staking.connect(admin).setRequiredSignatures(3))
        .to.emit(staking, "RequiredSignaturesUpdated")
        .withArgs(2, 3);

      expect(await staking.requiredSignatures()).to.equal(3);
    });

    it("should reject setting zero required signatures", async function () {
      await expect(
        staking.connect(admin).setRequiredSignatures(0)
      ).to.be.revertedWithCustomError(staking, "InvalidRequiredSignatures");
    });

    it("should reject setting required signatures above signer count", async function () {
      await expect(
        staking.connect(admin).setRequiredSignatures(5)
      ).to.be.revertedWithCustomError(staking, "InvalidRequiredSignatures");
    });
  });

  describe("Provider Staking", function () {
    it("should allow provider to stake tokens", async function () {
      const duration = MIN_STAKE_DURATION;
      const blockTime = await time.latest();

      await expect(staking.connect(provider1).stake(STAKE_AMOUNT, duration))
        .to.emit(staking, "Staked")
        .withArgs(provider1.address, STAKE_AMOUNT, blockTime + duration + 1);

      const info = await staking.getProviderInfo(provider1.address);
      expect(info.stakeAmount).to.equal(STAKE_AMOUNT);
      expect(info.isBanned).to.be.false;
    });

    it("should reject stake with zero amount", async function () {
      await expect(
        staking.connect(provider1).stake(0, MIN_STAKE_DURATION)
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("should reject stake with duration less than minimum", async function () {
      await expect(
        staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION - 1)
      ).to.be.revertedWithCustomError(staking, "DurationTooShort");
    });

    it("should reject double staking", async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);

      await expect(
        staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION)
      ).to.be.revertedWithCustomError(staking, "AlreadyStaked");
    });

    it("should reject staking from banned provider", async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(police).slashAndBan(provider1.address);

      await expect(
        staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION)
      ).to.be.revertedWithCustomError(staking, "ProviderBanned");
    });
  });

  describe("Extend Stake Duration", function () {
    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
    });

    it("should allow extending stake duration", async function () {
      const newUnlockTime = (await time.latest()) + MIN_STAKE_DURATION * 2;

      await expect(staking.connect(provider1).extendStakeDuration(newUnlockTime))
        .to.emit(staking, "StakeExtended")
        .withArgs(provider1.address, newUnlockTime);

      const info = await staking.getProviderInfo(provider1.address);
      expect(info.unlockTime).to.equal(newUnlockTime);
    });

    it("should reject extension with duration less than minimum", async function () {
      const shortUnlockTime = (await time.latest()) + MIN_STAKE_DURATION - 100;

      await expect(
        staking.connect(provider1).extendStakeDuration(shortUnlockTime)
      ).to.be.revertedWithCustomError(staking, "DurationTooShort");
    });
  });

  describe("Increase Stake", function () {
    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
    });

    it("should allow increasing stake", async function () {
      const addAmount = ethers.parseEther("5000");
      const expectedTotal = STAKE_AMOUNT + addAmount;

      await expect(staking.connect(provider1).increaseStake(addAmount))
        .to.emit(staking, "StakeIncreased");

      const info = await staking.getProviderInfo(provider1.address);
      expect(info.stakeAmount).to.equal(expectedTotal);
    });

    it("should reject increase with zero amount", async function () {
      await expect(
        staking.connect(provider1).increaseStake(0)
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });
  });

  describe("Withdraw Stake", function () {
    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
    });

    it("should allow withdrawal after unlock time", async function () {
      await time.increase(MIN_STAKE_DURATION + 1);

      const balanceBefore = await tlpToken.balanceOf(provider1.address);

      await expect(staking.connect(provider1).withdrawStake())
        .to.emit(staking, "StakeWithdrawn")
        .withArgs(provider1.address, STAKE_AMOUNT);

      const balanceAfter = await tlpToken.balanceOf(provider1.address);
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });

    it("should reject withdrawal before unlock time", async function () {
      await expect(
        staking.connect(provider1).withdrawStake()
      ).to.be.revertedWithCustomError(staking, "StakeLocked");
    });
  });

  describe("User Deposits", function () {
    it("should allow user to deposit", async function () {
      const balanceBefore = await tlpToken.balanceOf(user1.address);

      await expect(staking.connect(user1).deposit(DEPOSIT_AMOUNT))
        .to.emit(staking, "Deposited")
        .withArgs(user1.address, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT);

      const balanceAfter = await tlpToken.balanceOf(user1.address);
      expect(balanceBefore - balanceAfter).to.equal(DEPOSIT_AMOUNT);
      expect(await staking.getUserBalance(user1.address)).to.equal(DEPOSIT_AMOUNT);
    });

    it("should allow multiple deposits", async function () {
      await staking.connect(user1).deposit(DEPOSIT_AMOUNT);
      await staking.connect(user1).deposit(DEPOSIT_AMOUNT);

      expect(await staking.getUserBalance(user1.address)).to.equal(DEPOSIT_AMOUNT * 2n);
    });

    it("should reject deposit with zero amount", async function () {
      await expect(
        staking.connect(user1).deposit(0)
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });
  });

  describe("User Withdrawals with Signatures", function () {
    beforeEach(async function () {
      await staking.connect(user1).deposit(DEPOSIT_AMOUNT);
    });

    it("should allow user to withdraw with valid signatures", async function () {
      const nonce = await staking.getNonce(user1.address);
      const deadline = await getDeadline();
      const signatures = await signWithdrawal(
        [signer1, signer2],
        user1.address,
        DEPOSIT_AMOUNT,
        nonce,
        deadline
      );

      const balanceBefore = await tlpToken.balanceOf(user1.address);

      await expect(staking.connect(user1).withdraw(DEPOSIT_AMOUNT, deadline, signatures))
        .to.emit(staking, "Withdrawn")
        .withArgs(user1.address, DEPOSIT_AMOUNT, 0n);

      const balanceAfter = await tlpToken.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(DEPOSIT_AMOUNT);
      expect(await staking.getUserBalance(user1.address)).to.equal(0);
    });

    it("should reject withdrawal with insufficient signatures", async function () {
      const nonce = await staking.getNonce(user1.address);
      const deadline = await getDeadline();
      const signatures = await signWithdrawal(
        [signer1], // Only 1 signature, need 2
        user1.address,
        DEPOSIT_AMOUNT,
        nonce,
        deadline
      );

      await expect(
        staking.connect(user1).withdraw(DEPOSIT_AMOUNT, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "InsufficientSignatures");
    });

    it("should reject withdrawal with invalid signer", async function () {
      const nonce = await staking.getNonce(user1.address);
      const deadline = await getDeadline();
      const signatures = await signWithdrawal(
        [signer1, user2], // user2 is not a signer
        user1.address,
        DEPOSIT_AMOUNT,
        nonce,
        deadline
      );

      await expect(
        staking.connect(user1).withdraw(DEPOSIT_AMOUNT, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "InvalidSignature");
    });

    it("should reject withdrawal with duplicate signatures", async function () {
      const nonce = await staking.getNonce(user1.address);
      const deadline = await getDeadline();
      const signatures = await signWithdrawal(
        [signer1, signer1], // Same signer twice
        user1.address,
        DEPOSIT_AMOUNT,
        nonce,
        deadline
      );

      await expect(
        staking.connect(user1).withdraw(DEPOSIT_AMOUNT, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "DuplicateSignature");
    });

    it("should reject withdrawal exceeding balance", async function () {
      const nonce = await staking.getNonce(user1.address);
      const deadline = await getDeadline();
      const excessAmount = DEPOSIT_AMOUNT * 2n;
      const signatures = await signWithdrawal(
        [signer1, signer2],
        user1.address,
        excessAmount,
        nonce,
        deadline
      );

      await expect(
        staking.connect(user1).withdraw(excessAmount, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "InsufficientBalance");
    });

    it("should reject withdrawal with expired deadline", async function () {
      const nonce = await staking.getNonce(user1.address);
      const deadline = await getDeadline(-3600); // 1 hour ago
      const signatures = await signWithdrawal(
        [signer1, signer2],
        user1.address,
        DEPOSIT_AMOUNT,
        nonce,
        deadline
      );

      await expect(
        staking.connect(user1).withdraw(DEPOSIT_AMOUNT, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "SignatureExpired");
    });

    it("should reject withdrawal with zero amount", async function () {
      const nonce = await staking.getNonce(user1.address);
      const deadline = await getDeadline();
      const signatures = await signWithdrawal(
        [signer1, signer2],
        user1.address,
        0n,
        nonce,
        deadline
      );

      await expect(
        staking.connect(user1).withdraw(0n, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("should reject replay attack with old nonce", async function () {
      // First withdrawal
      const nonce = await staking.getNonce(user1.address);
      const deadline = await getDeadline();
      const halfAmount = DEPOSIT_AMOUNT / 2n;
      const signatures = await signWithdrawal(
        [signer1, signer2],
        user1.address,
        halfAmount,
        nonce,
        deadline
      );

      await staking.connect(user1).withdraw(halfAmount, deadline, signatures);

      // Try to reuse same signatures - should fail because nonce changed
      await expect(
        staking.connect(user1).withdraw(halfAmount, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "InvalidSignature");
    });

    it("should increment nonce after each withdrawal", async function () {
      expect(await staking.getNonce(user1.address)).to.equal(0);

      const halfAmount = DEPOSIT_AMOUNT / 2n;

      // First withdrawal
      const nonce1 = await staking.getNonce(user1.address);
      const deadline1 = await getDeadline();
      const signatures1 = await signWithdrawal([signer1, signer2], user1.address, halfAmount, nonce1, deadline1);
      await staking.connect(user1).withdraw(halfAmount, deadline1, signatures1);

      expect(await staking.getNonce(user1.address)).to.equal(1);

      // Second withdrawal
      const nonce2 = await staking.getNonce(user1.address);
      const deadline2 = await getDeadline();
      const signatures2 = await signWithdrawal([signer1, signer2], user1.address, halfAmount, nonce2, deadline2);
      await staking.connect(user1).withdraw(halfAmount, deadline2, signatures2);

      expect(await staking.getNonce(user1.address)).to.equal(2);
    });
  });

  describe("Provider Claims with Signatures", function () {
    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(user1).deposit(DEPOSIT_AMOUNT);
    });

    it("should allow provider to claim with valid signatures", async function () {
      const rentalId = generateRentalId();
      const claimAmount = ethers.parseEther("100");
      const nonce = await staking.getNonce(provider1.address);
      const deadline = await getDeadline();

      const signatures = await signClaim(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        claimAmount,
        nonce,
        deadline
      );

      const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);
      const userPoolBalanceBefore = await staking.getUserBalance(user1.address);

      await expect(staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures))
        .to.emit(staking, "Claimed")
        .withArgs(rentalId, user1.address, provider1.address, claimAmount, 0n);

      const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);
      const userPoolBalanceAfter = await staking.getUserBalance(user1.address);

      expect(providerBalanceAfter - providerBalanceBefore).to.equal(claimAmount);
      expect(userPoolBalanceBefore - userPoolBalanceAfter).to.equal(claimAmount);
    });

    it("should reject claim with insufficient signatures", async function () {
      const rentalId = generateRentalId();
      const claimAmount = ethers.parseEther("100");
      const nonce = await staking.getNonce(provider1.address);
      const deadline = await getDeadline();

      const signatures = await signClaim(
        [signer1], // Only 1 signature
        rentalId,
        user1.address,
        provider1.address,
        claimAmount,
        nonce,
        deadline
      );

      await expect(
        staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "InsufficientSignatures");
    });

    it("should reject claim with invalid signer", async function () {
      const rentalId = generateRentalId();
      const claimAmount = ethers.parseEther("100");
      const nonce = await staking.getNonce(provider1.address);
      const deadline = await getDeadline();

      const signatures = await signClaim(
        [signer1, user2], // user2 is not a signer
        rentalId,
        user1.address,
        provider1.address,
        claimAmount,
        nonce,
        deadline
      );

      await expect(
        staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "InvalidSignature");
    });

    it("should reject claim from non-provider", async function () {
      const rentalId = generateRentalId();
      const claimAmount = ethers.parseEther("100");
      const nonce = await staking.getNonce(user2.address);
      const deadline = await getDeadline();

      const signatures = await signClaim(
        [signer1, signer2],
        rentalId,
        user1.address,
        user2.address,
        claimAmount,
        nonce,
        deadline
      );

      await expect(
        staking.connect(user2).claim(rentalId, user1.address, claimAmount, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "NotAProvider");
    });

    it("should reject claim from banned provider", async function () {
      await staking.connect(police).slashAndBan(provider1.address);

      const rentalId = generateRentalId();
      const claimAmount = ethers.parseEther("100");
      const nonce = await staking.getNonce(provider1.address);
      const deadline = await getDeadline();

      const signatures = await signClaim(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        claimAmount,
        nonce,
        deadline
      );

      // Slashed provider has 0 stake, so they're "not a provider" before the banned check
      await expect(
        staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "NotAProvider");
    });

    it("should reject claim exceeding user balance", async function () {
      const rentalId = generateRentalId();
      const excessAmount = DEPOSIT_AMOUNT * 2n;
      const nonce = await staking.getNonce(provider1.address);
      const deadline = await getDeadline();

      const signatures = await signClaim(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        excessAmount,
        nonce,
        deadline
      );

      await expect(
        staking.connect(provider1).claim(rentalId, user1.address, excessAmount, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "InsufficientBalance");
    });

    it("should reject claim with expired deadline", async function () {
      const rentalId = generateRentalId();
      const claimAmount = ethers.parseEther("100");
      const nonce = await staking.getNonce(provider1.address);
      const deadline = await getDeadline(-3600); // 1 hour ago

      const signatures = await signClaim(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        claimAmount,
        nonce,
        deadline
      );

      await expect(
        staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "SignatureExpired");
    });

    it("should reject claim with zero amount", async function () {
      const rentalId = generateRentalId();
      const nonce = await staking.getNonce(provider1.address);
      const deadline = await getDeadline();

      const signatures = await signClaim(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        0n,
        nonce,
        deadline
      );

      await expect(
        staking.connect(provider1).claim(rentalId, user1.address, 0n, deadline, signatures)
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("should allow same rental ID to be used multiple times (audit trail only)", async function () {
      const rentalId = generateRentalId();
      const claimAmount = ethers.parseEther("100");

      // First claim
      const nonce1 = await staking.getNonce(provider1.address);
      const deadline1 = await getDeadline();
      const signatures1 = await signClaim(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        claimAmount,
        nonce1,
        deadline1
      );
      await staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline1, signatures1);

      // Second claim with same rental ID (allowed - rental ID is for audit only)
      const nonce2 = await staking.getNonce(provider1.address);
      const deadline2 = await getDeadline();
      const signatures2 = await signClaim(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        claimAmount,
        nonce2,
        deadline2
      );
      await staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline2, signatures2);

      // User balance should be reduced by 2 * claimAmount
      expect(await staking.getUserBalance(user1.address)).to.equal(DEPOSIT_AMOUNT - claimAmount * 2n);
    });

    it("should allow multiple providers to claim from same user", async function () {
      await staking.connect(provider2).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);

      const claimAmount = ethers.parseEther("100");

      // Provider 1 claims
      const rentalId1 = generateRentalId();
      const nonce1 = await staking.getNonce(provider1.address);
      const deadline1 = await getDeadline();
      const signatures1 = await signClaim(
        [signer1, signer2],
        rentalId1,
        user1.address,
        provider1.address,
        claimAmount,
        nonce1,
        deadline1
      );
      await staking.connect(provider1).claim(rentalId1, user1.address, claimAmount, deadline1, signatures1);

      // Provider 2 claims
      const rentalId2 = generateRentalId();
      const nonce2 = await staking.getNonce(provider2.address);
      const deadline2 = await getDeadline();
      const signatures2 = await signClaim(
        [signer1, signer2],
        rentalId2,
        user1.address,
        provider2.address,
        claimAmount,
        nonce2,
        deadline2
      );
      await staking.connect(provider2).claim(rentalId2, user1.address, claimAmount, deadline2, signatures2);

      expect(await staking.getUserBalance(user1.address)).to.equal(DEPOSIT_AMOUNT - claimAmount * 2n);
    });
  });

  describe("Batch Claims", function () {
    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(user1).deposit(DEPOSIT_AMOUNT);
      await staking.connect(user2).deposit(DEPOSIT_AMOUNT);
    });

    it("should allow provider to batch claim from multiple users", async function () {
      const claimAmount = ethers.parseEther("100");
      const deadline = await getDeadline();

      const rentalId1 = generateRentalId();
      const rentalId2 = generateRentalId();

      const nonce1 = await staking.getNonce(provider1.address);
      const nonce2 = nonce1 + 1n;

      const signatures1 = await signClaim([signer1, signer2], rentalId1, user1.address, provider1.address, claimAmount, nonce1, deadline);
      const signatures2 = await signClaim([signer1, signer2], rentalId2, user2.address, provider1.address, claimAmount, nonce2, deadline);

      const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

      const claims = [
        { rentalId: rentalId1, user: user1.address, amount: claimAmount, deadline },
        { rentalId: rentalId2, user: user2.address, amount: claimAmount, deadline }
      ];

      const tx = await staking.connect(provider1).batchClaim(claims, [signatures1, signatures2]);

      await expect(tx).to.emit(staking, "Claimed").withArgs(rentalId1, user1.address, provider1.address, claimAmount, 0n);
      await expect(tx).to.emit(staking, "Claimed").withArgs(rentalId2, user2.address, provider1.address, claimAmount, 0n);

      const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);
      expect(providerBalanceAfter - providerBalanceBefore).to.equal(claimAmount * 2n);

      expect(await staking.getUserBalance(user1.address)).to.equal(DEPOSIT_AMOUNT - claimAmount);
      expect(await staking.getUserBalance(user2.address)).to.equal(DEPOSIT_AMOUNT - claimAmount);
    });

    it("should reject batch claim with array length mismatch", async function () {
      const claimAmount = ethers.parseEther("100");
      const deadline = await getDeadline();
      const rentalId1 = generateRentalId();
      const nonce1 = await staking.getNonce(provider1.address);
      const signatures1 = await signClaim([signer1, signer2], rentalId1, user1.address, provider1.address, claimAmount, nonce1, deadline);

      const claims = [
        { rentalId: rentalId1, user: user1.address, amount: claimAmount, deadline },
        { rentalId: generateRentalId(), user: user2.address, amount: claimAmount, deadline }
      ];

      await expect(
        staking.connect(provider1).batchClaim(claims, [signatures1])
      ).to.be.revertedWithCustomError(staking, "ArrayLengthMismatch");
    });

    it("should reject batch claim if any amount is zero", async function () {
      const claimAmount = ethers.parseEther("100");
      const deadline = await getDeadline();

      const rentalId1 = generateRentalId();
      const rentalId2 = generateRentalId();

      const nonce1 = await staking.getNonce(provider1.address);
      const nonce2 = nonce1 + 1n;

      const signatures1 = await signClaim([signer1, signer2], rentalId1, user1.address, provider1.address, claimAmount, nonce1, deadline);
      const signatures2 = await signClaim([signer1, signer2], rentalId2, user2.address, provider1.address, 0n, nonce2, deadline);

      const claims = [
        { rentalId: rentalId1, user: user1.address, amount: claimAmount, deadline },
        { rentalId: rentalId2, user: user2.address, amount: 0n, deadline }
      ];

      await expect(
        staking.connect(provider1).batchClaim(claims, [signatures1, signatures2])
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("should reject batch claim from non-provider", async function () {
      const claimAmount = ethers.parseEther("100");
      const deadline = await getDeadline();
      const rentalId1 = generateRentalId();
      const nonce1 = await staking.getNonce(user2.address);

      const signatures1 = await signClaim([signer1, signer2], rentalId1, user1.address, user2.address, claimAmount, nonce1, deadline);

      const claims = [{ rentalId: rentalId1, user: user1.address, amount: claimAmount, deadline }];

      await expect(
        staking.connect(user2).batchClaim(claims, [signatures1])
      ).to.be.revertedWithCustomError(staking, "NotAProvider");
    });

    it("should allow empty batch claim", async function () {
      const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

      await staking.connect(provider1).batchClaim([], []);

      const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);
      expect(providerBalanceAfter).to.equal(providerBalanceBefore);
    });
  });

  describe("Slashing - Type 1: Slash and Ban", function () {
    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
    });

    it("should slash all stake and ban provider", async function () {
      const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);

      await expect(staking.connect(police).slashAndBan(provider1.address))
        .to.emit(staking, "ProviderSlashed")
        .withArgs(provider1.address, STAKE_AMOUNT, true);

      const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(STAKE_AMOUNT);

      const info = await staking.getProviderInfo(provider1.address);
      expect(info.stakeAmount).to.equal(0);
      expect(info.isBanned).to.be.true;
      expect(info.slashCount).to.equal(1);
    });

    it("should reject slash of non-provider", async function () {
      await expect(
        staking.connect(police).slashAndBan(user1.address)
      ).to.be.revertedWithCustomError(staking, "NotAProvider");
    });
  });

  describe("Slashing - Type 2: Partial Slash", function () {
    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
    });

    it("should slash partial stake without banning", async function () {
      const slashAmount = STAKE_AMOUNT / 4n;
      const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);

      await expect(staking.connect(police).slashPartial(provider1.address, slashAmount))
        .to.emit(staking, "ProviderSlashed")
        .withArgs(provider1.address, slashAmount, false);

      const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(slashAmount);

      const info = await staking.getProviderInfo(provider1.address);
      expect(info.stakeAmount).to.equal(STAKE_AMOUNT - slashAmount);
      expect(info.isBanned).to.be.false;
      expect(info.slashCount).to.equal(1);
    });

    it("should increment slashCount on multiple partial slashes", async function () {
      const slashAmount = STAKE_AMOUNT / 10n;

      // First slash
      await staking.connect(police).slashPartial(provider1.address, slashAmount);
      let info = await staking.getProviderInfo(provider1.address);
      expect(info.slashCount).to.equal(1);

      // Second slash
      await staking.connect(police).slashPartial(provider1.address, slashAmount);
      info = await staking.getProviderInfo(provider1.address);
      expect(info.slashCount).to.equal(2);

      // Third slash
      await staking.connect(police).slashPartial(provider1.address, slashAmount);
      info = await staking.getProviderInfo(provider1.address);
      expect(info.slashCount).to.equal(3);

      expect(info.stakeAmount).to.equal(STAKE_AMOUNT - (slashAmount * 3n));
    });

    it("should have slashCount of zero for new provider", async function () {
      const info = await staking.getProviderInfo(provider1.address);
      expect(info.slashCount).to.equal(0);
    });
  });

  describe("Unban Provider", function () {
    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(police).slashAndBan(provider1.address);
    });

    it("should allow admin to unban provider", async function () {
      await expect(staking.connect(admin).unbanProvider(provider1.address))
        .to.emit(staking, "ProviderUnbanned")
        .withArgs(provider1.address);

      const info = await staking.getProviderInfo(provider1.address);
      expect(info.isBanned).to.be.false;

      // Provider should be able to stake again
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
    });
  });

  describe("Admin Functions", function () {
    it("should update minimum stake duration", async function () {
      const newDuration = 60 * 24 * 60 * 60;

      await expect(staking.connect(admin).setMinStakeDuration(newDuration))
        .to.emit(staking, "MinStakeDurationUpdated")
        .withArgs(MIN_STAKE_DURATION, newDuration);

      expect(await staking.minStakeDuration()).to.equal(newDuration);
    });

    it("should update treasury address", async function () {
      await expect(staking.connect(admin).setTreasury(user1.address))
        .to.emit(staking, "TreasuryUpdated")
        .withArgs(treasury.address, user1.address);

      expect(await staking.treasury()).to.equal(user1.address);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(user1).deposit(DEPOSIT_AMOUNT);
    });

    it("should return correct provider info", async function () {
      const info = await staking.getProviderInfo(provider1.address);
      expect(info.stakeAmount).to.equal(STAKE_AMOUNT);
      expect(info.isBanned).to.be.false;
    });

    it("should check if provider is active", async function () {
      expect(await staking.isProviderActive(provider1.address)).to.be.true;
      expect(await staking.isProviderActive(user1.address)).to.be.false;
    });

    it("should return user balance", async function () {
      expect(await staking.getUserBalance(user1.address)).to.equal(DEPOSIT_AMOUNT);
      expect(await staking.getUserBalance(user2.address)).to.equal(0);
    });

    it("should return nonce", async function () {
      expect(await staking.getNonce(user1.address)).to.equal(0);
    });

    it("should return domain separator", async function () {
      const domainSeparator = await staking.domainSeparator();
      expect(domainSeparator).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("Commission on Claims", function () {
    const COMMISSION_5_PERCENT = 500n; // 5% in basis points
    const COMMISSION_10_PERCENT = 1000n; // 10% in basis points
    const claimAmount = ethers.parseEther("100");

    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(user1).deposit(DEPOSIT_AMOUNT);
    });

    describe("setCommission", function () {
      it("should allow admin to set commission", async function () {
        await expect(staking.connect(admin).setCommission(COMMISSION_5_PERCENT))
          .to.emit(staking, "CommissionUpdated")
          .withArgs(0, COMMISSION_5_PERCENT);

        expect(await staking.commissionBps()).to.equal(COMMISSION_5_PERCENT);
      });

      it("should reject commission above 100%", async function () {
        await expect(
          staking.connect(admin).setCommission(10001n)
        ).to.be.revertedWithCustomError(staking, "CommissionTooHigh");
      });

      it("should allow setting commission to exactly 100%", async function () {
        await expect(staking.connect(admin).setCommission(10000n))
          .to.emit(staking, "CommissionUpdated")
          .withArgs(0, 10000n);
      });

      it("should reject commission update by non-admin", async function () {
        await expect(
          staking.connect(user1).setCommission(COMMISSION_5_PERCENT)
        ).to.be.reverted;
      });

      it("should allow setting commission to zero", async function () {
        await staking.connect(admin).setCommission(COMMISSION_5_PERCENT);
        await expect(staking.connect(admin).setCommission(0n))
          .to.emit(staking, "CommissionUpdated")
          .withArgs(COMMISSION_5_PERCENT, 0n);

        expect(await staking.commissionBps()).to.equal(0);
      });
    });

    describe("claim with commission", function () {
      it("should deduct commission and send to treasury", async function () {
        await staking.connect(admin).setCommission(COMMISSION_5_PERCENT);

        const rentalId = generateRentalId();
        const nonce = await staking.getNonce(provider1.address);
        const deadline = await getDeadline();
        const signatures = await signClaim([signer1, signer2], rentalId, user1.address, provider1.address, claimAmount, nonce, deadline);

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        const expectedCommission = (claimAmount * COMMISSION_5_PERCENT) / 10000n;
        const expectedProviderAmount = claimAmount - expectedCommission;

        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedCommission);
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(expectedProviderAmount);
      });

      it("should calculate commission correctly for 10%", async function () {
        await staking.connect(admin).setCommission(COMMISSION_10_PERCENT);

        const rentalId = generateRentalId();
        const nonce = await staking.getNonce(provider1.address);
        const deadline = await getDeadline();
        const signatures = await signClaim([signer1, signer2], rentalId, user1.address, provider1.address, claimAmount, nonce, deadline);

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        const expectedCommission = (claimAmount * COMMISSION_10_PERCENT) / 10000n;
        const expectedProviderAmount = claimAmount - expectedCommission;

        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedCommission);
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(expectedProviderAmount);
      });

      it("should transfer full amount to provider with 0% commission", async function () {
        // Commission defaults to 0
        expect(await staking.commissionBps()).to.equal(0);

        const rentalId = generateRentalId();
        const nonce = await staking.getNonce(provider1.address);
        const deadline = await getDeadline();
        const signatures = await signClaim([signer1, signer2], rentalId, user1.address, provider1.address, claimAmount, nonce, deadline);

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(claimAmount);
      });

      it("should transfer full amount to treasury with 100% commission", async function () {
        await staking.connect(admin).setCommission(10000n); // 100%

        const rentalId = generateRentalId();
        const nonce = await staking.getNonce(provider1.address);
        const deadline = await getDeadline();
        const signatures = await signClaim([signer1, signer2], rentalId, user1.address, provider1.address, claimAmount, nonce, deadline);

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(claimAmount);
        expect(providerBalanceAfter).to.equal(providerBalanceBefore);
      });

      it("should emit Claimed event with commission amount", async function () {
        await staking.connect(admin).setCommission(COMMISSION_5_PERCENT);

        const rentalId = generateRentalId();
        const nonce = await staking.getNonce(provider1.address);
        const deadline = await getDeadline();
        const signatures = await signClaim([signer1, signer2], rentalId, user1.address, provider1.address, claimAmount, nonce, deadline);

        const expectedCommission = (claimAmount * COMMISSION_5_PERCENT) / 10000n;

        await expect(staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures))
          .to.emit(staking, "Claimed")
          .withArgs(rentalId, user1.address, provider1.address, claimAmount, expectedCommission);
      });
    });

    describe("batchClaim with commission", function () {
      it("should deduct commission on batch claim", async function () {
        await staking.connect(admin).setCommission(COMMISSION_5_PERCENT);
        await staking.connect(user2).deposit(DEPOSIT_AMOUNT);

        const deadline = await getDeadline();
        const rentalId1 = generateRentalId();
        const rentalId2 = generateRentalId();
        const nonce1 = await staking.getNonce(provider1.address);
        const nonce2 = nonce1 + 1n;

        const signatures1 = await signClaim([signer1, signer2], rentalId1, user1.address, provider1.address, claimAmount, nonce1, deadline);
        const signatures2 = await signClaim([signer1, signer2], rentalId2, user2.address, provider1.address, claimAmount, nonce2, deadline);

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        const claims = [
          { rentalId: rentalId1, user: user1.address, amount: claimAmount, deadline },
          { rentalId: rentalId2, user: user2.address, amount: claimAmount, deadline }
        ];

        await staking.connect(provider1).batchClaim(claims, [signatures1, signatures2]);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        const totalAmount = claimAmount * 2n;
        const expectedCommission = (totalAmount * COMMISSION_5_PERCENT) / 10000n;
        const expectedProviderAmount = totalAmount - expectedCommission;

        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedCommission);
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(expectedProviderAmount);
      });

      it("should handle batch claim with 0% commission", async function () {
        await staking.connect(user2).deposit(DEPOSIT_AMOUNT);

        const deadline = await getDeadline();
        const rentalId1 = generateRentalId();
        const rentalId2 = generateRentalId();
        const nonce1 = await staking.getNonce(provider1.address);
        const nonce2 = nonce1 + 1n;

        const signatures1 = await signClaim([signer1, signer2], rentalId1, user1.address, provider1.address, claimAmount, nonce1, deadline);
        const signatures2 = await signClaim([signer1, signer2], rentalId2, user2.address, provider1.address, claimAmount, nonce2, deadline);

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        const claims = [
          { rentalId: rentalId1, user: user1.address, amount: claimAmount, deadline },
          { rentalId: rentalId2, user: user2.address, amount: claimAmount, deadline }
        ];

        await staking.connect(provider1).batchClaim(claims, [signatures1, signatures2]);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(claimAmount * 2n);
      });
    });
  });

  describe("Migration Scenario", function () {
    it("should handle provider migration seamlessly", async function () {
      // Setup: Two providers stake
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(provider2).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);

      // User deposits funds
      const depositAmount = ethers.parseEther("100");
      await staking.connect(user1).deposit(depositAmount);

      // Provider 1 serves the user for some time, then claims
      const claim1Amount = ethers.parseEther("30");
      const rentalId1 = generateRentalId();
      const nonce1 = await staking.getNonce(provider1.address);
      const deadline1 = await getDeadline();
      const signatures1 = await signClaim([signer1, signer2], rentalId1, user1.address, provider1.address, claim1Amount, nonce1, deadline1);

      await staking.connect(provider1).claim(rentalId1, user1.address, claim1Amount, deadline1, signatures1);

      // Provider 1 goes down, backend migrates user to Provider 2
      // Provider 2 serves the user and claims
      const claim2Amount = ethers.parseEther("40");
      const rentalId2 = generateRentalId();
      const nonce2 = await staking.getNonce(provider2.address);
      const deadline2 = await getDeadline();
      const signatures2 = await signClaim([signer1, signer2], rentalId2, user1.address, provider2.address, claim2Amount, nonce2, deadline2);

      await staking.connect(provider2).claim(rentalId2, user1.address, claim2Amount, deadline2, signatures2);

      // Verify: User's remaining balance is correct
      const expectedRemaining = depositAmount - claim1Amount - claim2Amount;
      expect(await staking.getUserBalance(user1.address)).to.equal(expectedRemaining);

      // User can withdraw their remaining balance
      const userNonce = await staking.getNonce(user1.address);
      const userDeadline = await getDeadline();
      const withdrawSignatures = await signWithdrawal([signer1, signer2], user1.address, expectedRemaining, userNonce, userDeadline);

      await staking.connect(user1).withdraw(expectedRemaining, userDeadline, withdrawSignatures);
      expect(await staking.getUserBalance(user1.address)).to.equal(0);
    });
  });

  describe("Edge Cases", function () {
    it("should handle 3-of-3 signature requirement", async function () {
      await staking.connect(admin).setRequiredSignatures(3);
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(user1).deposit(DEPOSIT_AMOUNT);

      // Claim with 3 signatures
      const rentalId = generateRentalId();
      const claimAmount = ethers.parseEther("100");
      const nonce = await staking.getNonce(provider1.address);
      const deadline = await getDeadline();
      const signatures = await signClaim(
        [signer1, signer2, signer3],
        rentalId,
        user1.address,
        provider1.address,
        claimAmount,
        nonce,
        deadline
      );

      await expect(staking.connect(provider1).claim(rentalId, user1.address, claimAmount, deadline, signatures))
        .to.emit(staking, "Claimed");
    });

    it("should handle user balance going to zero", async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(user1).deposit(DEPOSIT_AMOUNT);

      // Provider claims entire balance
      const rentalId = generateRentalId();
      const nonce = await staking.getNonce(provider1.address);
      const deadline = await getDeadline();
      const signatures = await signClaim([signer1, signer2], rentalId, user1.address, provider1.address, DEPOSIT_AMOUNT, nonce, deadline);

      await staking.connect(provider1).claim(rentalId, user1.address, DEPOSIT_AMOUNT, deadline, signatures);

      expect(await staking.getUserBalance(user1.address)).to.equal(0);

      // Subsequent claim should fail
      const rentalId2 = generateRentalId();
      const nonce2 = await staking.getNonce(provider1.address);
      const deadline2 = await getDeadline();
      const signatures2 = await signClaim([signer1, signer2], rentalId2, user1.address, provider1.address, 1n, nonce2, deadline2);

      await expect(
        staking.connect(provider1).claim(rentalId2, user1.address, 1n, deadline2, signatures2)
      ).to.be.revertedWithCustomError(staking, "InsufficientBalance");
    });

    it("should handle concurrent claims from multiple providers", async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(provider2).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      await staking.connect(user1).deposit(DEPOSIT_AMOUNT);

      const claimAmount = ethers.parseEther("100");

      // Both providers have valid claim signatures
      const rentalId1 = generateRentalId();
      const rentalId2 = generateRentalId();
      const nonce1 = await staking.getNonce(provider1.address);
      const nonce2 = await staking.getNonce(provider2.address);
      const deadline = await getDeadline();

      const signatures1 = await signClaim([signer1, signer2], rentalId1, user1.address, provider1.address, claimAmount, nonce1, deadline);
      const signatures2 = await signClaim([signer1, signer2], rentalId2, user1.address, provider2.address, claimAmount, nonce2, deadline);

      // Both claims should succeed
      await staking.connect(provider1).claim(rentalId1, user1.address, claimAmount, deadline, signatures1);
      await staking.connect(provider2).claim(rentalId2, user1.address, claimAmount, deadline, signatures2);

      expect(await staking.getUserBalance(user1.address)).to.equal(DEPOSIT_AMOUNT - claimAmount * 2n);
    });
  });
});
