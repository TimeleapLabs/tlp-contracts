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
  const MIN_STAKE_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds

  // VM pricing constants
  const VM_SMALL = ethers.encodeBytes32String("vm.small");
  const VM_MEDIUM = ethers.encodeBytes32String("vm.medium");
  const VM_LARGE = ethers.encodeBytes32String("vm.large");
  const VM_UNCONFIGURED = ethers.encodeBytes32String("vm.unconfigured");

  const PRICE_SMALL = ethers.parseEther("0.001");
  const PRICE_MEDIUM = ethers.parseEther("0.005");
  const PRICE_LARGE = ethers.parseEther("0.01");

  const RENTAL_DURATION = 3600n;
  const RENTAL_AMOUNT = PRICE_SMALL * RENTAL_DURATION;

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

  // Helper to generate unique rental IDs
  let rentalIdCounter = 0n;
  function generateRentalId(): string {
    rentalIdCounter++;
    return ethers.zeroPadValue(ethers.toBeHex(rentalIdCounter), 32);
  }

  // Helper function to sign rental approval
  async function signRentalApproval(
    signersList: HardhatEthersSigner[],
    rentalId: string,
    user: string,
    provider: string,
    vm: string,
    duration: bigint,
    nonce: bigint
  ): Promise<string[]> {
    const domain = await getDomain();
    const types = {
      RentalApproval: [
        { name: "rentalId", type: "bytes32" },
        { name: "user", type: "address" },
        { name: "provider", type: "address" },
        { name: "vm", type: "bytes32" },
        { name: "duration", type: "uint256" },
        { name: "nonce", type: "uint256" }
      ]
    };
    const value = { rentalId, user, provider, vm, duration, nonce };

    const signatures: string[] = [];
    for (const signer of signersList) {
      const signature = await signer.signTypedData(domain, types, value);
      signatures.push(signature);
    }
    return signatures;
  }

  // Helper function to sign withdrawal approval
  async function signWithdrawalApproval(
    signersList: HardhatEthersSigner[],
    rentalId: string,
    provider: string,
    amount: bigint,
    nonce: bigint
  ): Promise<string[]> {
    const domain = await getDomain();
    const types = {
      WithdrawalApproval: [
        { name: "rentalId", type: "bytes32" },
        { name: "provider", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" }
      ]
    };
    const value = { rentalId, provider, amount, nonce };

    const signatures: string[] = [];
    for (const signer of signersList) {
      const signature = await signer.signTypedData(domain, types, value);
      signatures.push(signature);
    }
    return signatures;
  }

  // Helper function to sign refund approval
  async function signRefundApproval(
    signersList: HardhatEthersSigner[],
    rentalId: string,
    user: string,
    amount: bigint,
    nonce: bigint
  ): Promise<string[]> {
    const domain = await getDomain();
    const types = {
      RefundApproval: [
        { name: "rentalId", type: "bytes32" },
        { name: "user", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" }
      ]
    };
    const value = { rentalId, user, amount, nonce };

    const signatures: string[] = [];
    for (const signer of signersList) {
      const signature = await signer.signTypedData(domain, types, value);
      signatures.push(signature);
    }
    return signatures;
  }

  // Helper to create a rental with signatures
  async function makeRental(
    user: HardhatEthersSigner,
    provider: HardhatEthersSigner,
    vm: string,
    duration: bigint,
    rentalId?: string
  ): Promise<string> {
    const id = rentalId || generateRentalId();
    const nonce = await staking.rentalNonces(user.address);
    const signatures = await signRentalApproval(
      [signer1, signer2],
      id,
      user.address,
      provider.address,
      vm,
      duration,
      nonce
    );
    await staking.connect(user).rentFromProvider(id, provider.address, vm, duration, signatures);
    return id;
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

    // Configure VM prices
    await staking.connect(admin).setVmPrice(VM_SMALL, PRICE_SMALL);
    await staking.connect(admin).setVmPrice(VM_MEDIUM, PRICE_MEDIUM);
    await staking.connect(admin).setVmPrice(VM_LARGE, PRICE_LARGE);

    // Add signers and set required signatures
    await staking.connect(admin).addSigner(signer1.address);
    await staking.connect(admin).addSigner(signer2.address);
    await staking.connect(admin).addSigner(signer3.address);
    await staking.connect(admin).setRequiredRentalSignatures(2);
    await staking.connect(admin).setRequiredWithdrawalSignatures(2);
    await staking.connect(admin).setRequiredRefundSignatures(2);

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
      expect(await staking.requiredRentalSignatures()).to.equal(2);
      expect(await staking.requiredWithdrawalSignatures()).to.equal(2);
      expect(await staking.requiredRefundSignatures()).to.equal(2);
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
      // All three should be adjusted to 1 (the number of remaining signers)
      expect(await staking.requiredRentalSignatures()).to.equal(1);
      expect(await staking.requiredWithdrawalSignatures()).to.equal(1);
      expect(await staking.requiredRefundSignatures()).to.equal(1);
    });

    it("should set required rental signatures", async function () {
      await expect(staking.connect(admin).setRequiredRentalSignatures(3))
        .to.emit(staking, "RequiredRentalSignaturesUpdated")
        .withArgs(2, 3);

      expect(await staking.requiredRentalSignatures()).to.equal(3);
    });

    it("should set required withdrawal signatures", async function () {
      await expect(staking.connect(admin).setRequiredWithdrawalSignatures(3))
        .to.emit(staking, "RequiredWithdrawalSignaturesUpdated")
        .withArgs(2, 3);

      expect(await staking.requiredWithdrawalSignatures()).to.equal(3);
    });

    it("should set required refund signatures", async function () {
      await expect(staking.connect(admin).setRequiredRefundSignatures(1))
        .to.emit(staking, "RequiredRefundSignaturesUpdated")
        .withArgs(2, 1);

      expect(await staking.requiredRefundSignatures()).to.equal(1);
    });

    it("should reject setting zero required signatures", async function () {
      await expect(
        staking.connect(admin).setRequiredRentalSignatures(0)
      ).to.be.revertedWithCustomError(staking, "InvalidRequiredSignatures");
      await expect(
        staking.connect(admin).setRequiredWithdrawalSignatures(0)
      ).to.be.revertedWithCustomError(staking, "InvalidRequiredSignatures");
      await expect(
        staking.connect(admin).setRequiredRefundSignatures(0)
      ).to.be.revertedWithCustomError(staking, "InvalidRequiredSignatures");
    });

    it("should reject setting required signatures above signer count", async function () {
      await expect(
        staking.connect(admin).setRequiredRentalSignatures(5)
      ).to.be.revertedWithCustomError(staking, "InvalidRequiredSignatures");
      await expect(
        staking.connect(admin).setRequiredWithdrawalSignatures(5)
      ).to.be.revertedWithCustomError(staking, "InvalidRequiredSignatures");
      await expect(
        staking.connect(admin).setRequiredRefundSignatures(5)
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

  describe("VM Pricing", function () {
    it("should allow admin to set VM price", async function () {
      const newVm = ethers.encodeBytes32String("vm.xlarge");
      const newPrice = ethers.parseEther("0.02");

      await expect(staking.connect(admin).setVmPrice(newVm, newPrice))
        .to.emit(staking, "VmPriceUpdated")
        .withArgs(newVm, 0, newPrice);

      expect(await staking.vmPricePerSecond(newVm)).to.equal(newPrice);
    });

    it("should reject VM price update by non-admin", async function () {
      await expect(
        staking.connect(user1).setVmPrice(VM_SMALL, ethers.parseEther("0.1"))
      ).to.be.reverted;
    });
  });

  describe("User Rentals with Signatures", function () {
    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
    });

    it("should allow user to rent from provider with valid signatures", async function () {
      const expectedAmount = PRICE_SMALL * RENTAL_DURATION;
      const rentalId = generateRentalId();

      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        VM_SMALL,
        RENTAL_DURATION,
        nonce
      );

      await expect(staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_SMALL, RENTAL_DURATION, signatures))
        .to.emit(staking, "RentalCreated")
        .withArgs(user1.address, provider1.address, rentalId, expectedAmount, VM_SMALL, RENTAL_DURATION);

      const rental = await staking.getRental(rentalId);
      expect(rental.user).to.equal(user1.address);
      expect(rental.provider).to.equal(provider1.address);
      expect(rental.amount).to.equal(expectedAmount);
      expect(rental.vm).to.equal(VM_SMALL);
      expect(rental.duration).to.equal(RENTAL_DURATION);
    });

    it("should reject rental with insufficient signatures", async function () {
      const rentalId = generateRentalId();
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1], // Only 1 signature, need 2
        rentalId,
        user1.address,
        provider1.address,
        VM_SMALL,
        RENTAL_DURATION,
        nonce
      );

      await expect(
        staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_SMALL, RENTAL_DURATION, signatures)
      ).to.be.revertedWithCustomError(staking, "InsufficientSignatures");
    });

    it("should reject rental with invalid signer", async function () {
      const rentalId = generateRentalId();
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, user2], // user2 is not a signer
        rentalId,
        user1.address,
        provider1.address,
        VM_SMALL,
        RENTAL_DURATION,
        nonce
      );

      await expect(
        staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_SMALL, RENTAL_DURATION, signatures)
      ).to.be.revertedWithCustomError(staking, "InvalidSignature");
    });

    it("should reject rental with duplicate signatures", async function () {
      const rentalId = generateRentalId();
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, signer1], // Same signer twice
        rentalId,
        user1.address,
        provider1.address,
        VM_SMALL,
        RENTAL_DURATION,
        nonce
      );

      await expect(
        staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_SMALL, RENTAL_DURATION, signatures)
      ).to.be.revertedWithCustomError(staking, "DuplicateSignature");
    });

    it("should reject rental for unconfigured VM", async function () {
      const rentalId = generateRentalId();
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        VM_UNCONFIGURED,
        RENTAL_DURATION,
        nonce
      );

      await expect(
        staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_UNCONFIGURED, RENTAL_DURATION, signatures)
      ).to.be.revertedWithCustomError(staking, "VmNotConfigured");
    });

    it("should reject rental to non-provider", async function () {
      const rentalId = generateRentalId();
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        user2.address,
        VM_SMALL,
        RENTAL_DURATION,
        nonce
      );

      await expect(
        staking.connect(user1).rentFromProvider(rentalId, user2.address, VM_SMALL, RENTAL_DURATION, signatures)
      ).to.be.revertedWithCustomError(staking, "NotAProvider");
    });

    it("should reject rental to banned provider", async function () {
      await staking.connect(police).slashAndBan(provider1.address);

      const rentalId = generateRentalId();
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        VM_SMALL,
        RENTAL_DURATION,
        nonce
      );

      await expect(
        staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_SMALL, RENTAL_DURATION, signatures)
      ).to.be.revertedWithCustomError(staking, "ProviderBanned");
    });

    it("should reject replay attack with old nonce", async function () {
      // First rental
      const rentalId1 = generateRentalId();
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, signer2],
        rentalId1,
        user1.address,
        provider1.address,
        VM_SMALL,
        RENTAL_DURATION,
        nonce
      );

      await staking.connect(user1).rentFromProvider(rentalId1, provider1.address, VM_SMALL, RENTAL_DURATION, signatures);

      // Try to reuse same signatures with new rental ID
      const rentalId2 = generateRentalId();
      await expect(
        staking.connect(user1).rentFromProvider(rentalId2, provider1.address, VM_SMALL, RENTAL_DURATION, signatures)
      ).to.be.revertedWithCustomError(staking, "InvalidSignature");
    });

    it("should reject duplicate rental ID", async function () {
      const rentalId = generateRentalId();
      await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION, rentalId);

      // Try to create another rental with same ID
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        VM_SMALL,
        RENTAL_DURATION,
        nonce
      );

      await expect(
        staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_SMALL, RENTAL_DURATION, signatures)
      ).to.be.revertedWithCustomError(staking, "RentalAlreadyExists");
    });

    it("should reject rental when duration + grace period exceeds stake unlock time", async function () {
      // Provider staked for 30 days, grace period is 7 days
      // Try to rent for 25 days: 25 + 7 = 32 days > 30 days = fail
      const longDuration = 25n * 24n * 60n * 60n; // 25 days

      const rentalId = generateRentalId();
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        VM_SMALL,
        longDuration,
        nonce
      );

      await expect(
        staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_SMALL, longDuration, signatures)
      ).to.be.revertedWithCustomError(staking, "RentalExceedsStakeDuration");
    });

    it("should allow rental when duration + grace period is within stake unlock time", async function () {
      // Get actual provider unlock time and current timestamp
      const providerInfo = await staking.getProviderInfo(provider1.address);
      const currentTime = BigInt(await time.latest());
      const gracePeriod = await staking.rentalGracePeriod();

      // Calculate maximum allowed duration: unlockTime - currentTime - gracePeriod - 1 (buffer for block advancement)
      const maxDuration = providerInfo.unlockTime - currentTime - gracePeriod - 1n;

      const rentalId = generateRentalId();
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        VM_SMALL,
        maxDuration,
        nonce
      );

      await expect(
        staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_SMALL, maxDuration, signatures)
      ).to.emit(staking, "RentalCreated");
    });

    it("should allow admin to update grace period", async function () {
      const newGracePeriod = 14n * 24n * 60n * 60n; // 14 days

      await expect(staking.connect(admin).setRentalGracePeriod(newGracePeriod))
        .to.emit(staking, "RentalGracePeriodUpdated")
        .withArgs(7n * 24n * 60n * 60n, newGracePeriod);

      expect(await staking.rentalGracePeriod()).to.equal(newGracePeriod);
    });

    it("should allow setting grace period to zero", async function () {
      await staking.connect(admin).setRentalGracePeriod(0);
      expect(await staking.rentalGracePeriod()).to.equal(0);

      // Get actual provider unlock time and current timestamp
      const providerInfo = await staking.getProviderInfo(provider1.address);
      const currentTime = BigInt(await time.latest());

      // With zero grace period, max duration is unlockTime - currentTime - 1 (buffer)
      const maxDuration = providerInfo.unlockTime - currentTime - 1n;

      const rentalId = generateRentalId();
      const nonce = await staking.rentalNonces(user1.address);
      const signatures = await signRentalApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        provider1.address,
        VM_SMALL,
        maxDuration,
        nonce
      );

      await expect(
        staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_SMALL, maxDuration, signatures)
      ).to.emit(staking, "RentalCreated");
    });

    it("should increment nonce after each rental", async function () {
      expect(await staking.rentalNonces(user1.address)).to.equal(0);

      await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
      expect(await staking.rentalNonces(user1.address)).to.equal(1);

      await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
      expect(await staking.rentalNonces(user1.address)).to.equal(2);
    });
  });

  describe("Provider Rental Withdrawal with Signatures", function () {
    let rentalId: string;

    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      rentalId = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
    });

    it("should allow provider to withdraw with valid signatures", async function () {
      const nonce = await staking.withdrawalNonces(rentalId);
      const signatures = await signWithdrawalApproval(
        [signer1, signer2],
        rentalId,
        provider1.address,
        RENTAL_AMOUNT,
        nonce
      );

      const balanceBefore = await tlpToken.balanceOf(provider1.address);

      await expect(staking.connect(provider1).withdrawRental(rentalId, RENTAL_AMOUNT, signatures))
        .to.emit(staking, "RentalWithdrawn")
        .withArgs(provider1.address, rentalId, RENTAL_AMOUNT);

      const balanceAfter = await tlpToken.balanceOf(provider1.address);
      expect(balanceAfter - balanceBefore).to.equal(RENTAL_AMOUNT);
    });

    it("should reject withdrawal with insufficient signatures", async function () {
      const nonce = await staking.withdrawalNonces(rentalId);
      const signatures = await signWithdrawalApproval(
        [signer1],
        rentalId,
        provider1.address,
        RENTAL_AMOUNT,
        nonce
      );

      await expect(
        staking.connect(provider1).withdrawRental(rentalId, RENTAL_AMOUNT, signatures)
      ).to.be.revertedWithCustomError(staking, "InsufficientSignatures");
    });

    it("should reject withdrawal with invalid signer", async function () {
      const nonce = await staking.withdrawalNonces(rentalId);
      const signatures = await signWithdrawalApproval(
        [signer1, user1],
        rentalId,
        provider1.address,
        RENTAL_AMOUNT,
        nonce
      );

      await expect(
        staking.connect(provider1).withdrawRental(rentalId, RENTAL_AMOUNT, signatures)
      ).to.be.revertedWithCustomError(staking, "InvalidSignature");
    });

    it("should reject withdrawal exceeding available amount", async function () {
      const nonce = await staking.withdrawalNonces(rentalId);
      const excessiveAmount = RENTAL_AMOUNT * 2n;
      const signatures = await signWithdrawalApproval(
        [signer1, signer2],
        rentalId,
        provider1.address,
        excessiveAmount,
        nonce
      );

      await expect(
        staking.connect(provider1).withdrawRental(rentalId, excessiveAmount, signatures)
      ).to.be.revertedWithCustomError(staking, "AmountExceedsAvailable");
    });

    it("should allow multiple partial withdrawals", async function () {
      const halfAmount = RENTAL_AMOUNT / 2n;

      // First withdrawal
      const nonce1 = await staking.withdrawalNonces(rentalId);
      const signatures1 = await signWithdrawalApproval(
        [signer1, signer2],
        rentalId,
        provider1.address,
        halfAmount,
        nonce1
      );
      await staking.connect(provider1).withdrawRental(rentalId, halfAmount, signatures1);

      // Second withdrawal
      const nonce2 = await staking.withdrawalNonces(rentalId);
      const signatures2 = await signWithdrawalApproval(
        [signer1, signer2],
        rentalId,
        provider1.address,
        halfAmount,
        nonce2
      );
      await staking.connect(provider1).withdrawRental(rentalId, halfAmount, signatures2);

      // Third withdrawal should fail - nothing left
      const nonce3 = await staking.withdrawalNonces(rentalId);
      const signatures3 = await signWithdrawalApproval(
        [signer1, signer2],
        rentalId,
        provider1.address,
        1n,
        nonce3
      );
      await expect(
        staking.connect(provider1).withdrawRental(rentalId, 1n, signatures3)
      ).to.be.revertedWithCustomError(staking, "AmountExceedsAvailable");
    });
  });

  describe("Batch Provider Withdrawal", function () {
    let rentalId1: string;
    let rentalId2: string;
    let rentalId3: string;

    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      rentalId1 = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
      rentalId2 = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
      rentalId3 = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
    });

    it("should allow provider to batch withdraw from multiple rentals", async function () {
      const nonce1 = await staking.withdrawalNonces(rentalId1);
      const nonce2 = await staking.withdrawalNonces(rentalId2);
      const nonce3 = await staking.withdrawalNonces(rentalId3);

      const signatures1 = await signWithdrawalApproval([signer1, signer2], rentalId1, provider1.address, RENTAL_AMOUNT, nonce1);
      const signatures2 = await signWithdrawalApproval([signer1, signer2], rentalId2, provider1.address, RENTAL_AMOUNT, nonce2);
      const signatures3 = await signWithdrawalApproval([signer1, signer2], rentalId3, provider1.address, RENTAL_AMOUNT, nonce3);

      const balanceBefore = await tlpToken.balanceOf(provider1.address);

      const tx = await staking.connect(provider1).batchWithdrawRental(
        [rentalId1, rentalId2, rentalId3],
        [RENTAL_AMOUNT, RENTAL_AMOUNT, RENTAL_AMOUNT],
        [signatures1, signatures2, signatures3]
      );

      // Check all events were emitted
      await expect(tx).to.emit(staking, "RentalWithdrawn").withArgs(provider1.address, rentalId1, RENTAL_AMOUNT);
      await expect(tx).to.emit(staking, "RentalWithdrawn").withArgs(provider1.address, rentalId2, RENTAL_AMOUNT);
      await expect(tx).to.emit(staking, "RentalWithdrawn").withArgs(provider1.address, rentalId3, RENTAL_AMOUNT);

      const balanceAfter = await tlpToken.balanceOf(provider1.address);
      expect(balanceAfter - balanceBefore).to.equal(RENTAL_AMOUNT * 3n);

      // Check all rentals are withdrawn
      const rental1 = await staking.getRental(rentalId1);
      const rental2 = await staking.getRental(rentalId2);
      const rental3 = await staking.getRental(rentalId3);
      expect(rental1.withdrawnAmount).to.equal(RENTAL_AMOUNT);
      expect(rental2.withdrawnAmount).to.equal(RENTAL_AMOUNT);
      expect(rental3.withdrawnAmount).to.equal(RENTAL_AMOUNT);
    });

    it("should reject batch withdrawal with array length mismatch", async function () {
      const nonce1 = await staking.withdrawalNonces(rentalId1);
      const signatures1 = await signWithdrawalApproval([signer1, signer2], rentalId1, provider1.address, RENTAL_AMOUNT, nonce1);

      // Mismatched arrays: 2 rental IDs but only 1 amount
      await expect(
        staking.connect(provider1).batchWithdrawRental(
          [rentalId1, rentalId2],
          [RENTAL_AMOUNT],
          [signatures1]
        )
      ).to.be.revertedWithCustomError(staking, "ArrayLengthMismatch");
    });

    it("should reject batch withdrawal if any amount is zero", async function () {
      const nonce1 = await staking.withdrawalNonces(rentalId1);
      const nonce2 = await staking.withdrawalNonces(rentalId2);

      const signatures1 = await signWithdrawalApproval([signer1, signer2], rentalId1, provider1.address, RENTAL_AMOUNT, nonce1);
      const signatures2 = await signWithdrawalApproval([signer1, signer2], rentalId2, provider1.address, 0n, nonce2);

      await expect(
        staking.connect(provider1).batchWithdrawRental(
          [rentalId1, rentalId2],
          [RENTAL_AMOUNT, 0n],
          [signatures1, signatures2]
        )
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("should reject batch withdrawal if caller is not the provider", async function () {
      const nonce1 = await staking.withdrawalNonces(rentalId1);
      const signatures1 = await signWithdrawalApproval([signer1, signer2], rentalId1, provider1.address, RENTAL_AMOUNT, nonce1);

      await expect(
        staking.connect(user1).batchWithdrawRental(
          [rentalId1],
          [RENTAL_AMOUNT],
          [signatures1]
        )
      ).to.be.revertedWithCustomError(staking, "RentalNotFound");
    });

    it("should reject batch withdrawal with invalid signatures", async function () {
      const nonce1 = await staking.withdrawalNonces(rentalId1);
      // Sign with wrong amount
      const signatures1 = await signWithdrawalApproval([signer1, signer2], rentalId1, provider1.address, RENTAL_AMOUNT / 2n, nonce1);

      await expect(
        staking.connect(provider1).batchWithdrawRental(
          [rentalId1],
          [RENTAL_AMOUNT],
          [signatures1]
        )
      ).to.be.revertedWithCustomError(staking, "InvalidSignature");
    });

    it("should allow partial batch withdrawal", async function () {
      const halfAmount = RENTAL_AMOUNT / 2n;

      const nonce1 = await staking.withdrawalNonces(rentalId1);
      const nonce2 = await staking.withdrawalNonces(rentalId2);

      const signatures1 = await signWithdrawalApproval([signer1, signer2], rentalId1, provider1.address, halfAmount, nonce1);
      const signatures2 = await signWithdrawalApproval([signer1, signer2], rentalId2, provider1.address, halfAmount, nonce2);

      const balanceBefore = await tlpToken.balanceOf(provider1.address);

      await staking.connect(provider1).batchWithdrawRental(
        [rentalId1, rentalId2],
        [halfAmount, halfAmount],
        [signatures1, signatures2]
      );

      const balanceAfter = await tlpToken.balanceOf(provider1.address);
      expect(balanceAfter - balanceBefore).to.equal(halfAmount * 2n);

      // Check rentals still have remaining balance
      const rental1 = await staking.getRental(rentalId1);
      const rental2 = await staking.getRental(rentalId2);
      expect(rental1.withdrawnAmount).to.equal(halfAmount);
      expect(rental2.withdrawnAmount).to.equal(halfAmount);
    });

    it("should allow empty batch withdrawal", async function () {
      const balanceBefore = await tlpToken.balanceOf(provider1.address);

      await staking.connect(provider1).batchWithdrawRental([], [], []);

      const balanceAfter = await tlpToken.balanceOf(provider1.address);
      expect(balanceAfter).to.equal(balanceBefore);
    });
  });

  describe("Refund with Signatures", function () {
    let rentalId: string;

    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      rentalId = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
    });

    it("should allow user to claim refund with valid signatures", async function () {
      const refundAmount = RENTAL_AMOUNT / 2n;

      const nonce = await staking.refundNonces(rentalId);
      const signatures = await signRefundApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        refundAmount,
        nonce
      );

      const balanceBefore = await tlpToken.balanceOf(user1.address);

      await expect(staking.connect(user1).claimRefund(rentalId, refundAmount, signatures))
        .to.emit(staking, "RefundClaimed")
        .withArgs(user1.address, provider1.address, rentalId, refundAmount);

      const balanceAfter = await tlpToken.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(refundAmount);
    });

    it("should reject refund with insufficient signatures", async function () {
      const nonce = await staking.refundNonces(rentalId);
      const signatures = await signRefundApproval(
        [signer1],
        rentalId,
        user1.address,
        RENTAL_AMOUNT,
        nonce
      );

      await expect(
        staking.connect(user1).claimRefund(rentalId, RENTAL_AMOUNT, signatures)
      ).to.be.revertedWithCustomError(staking, "InsufficientSignatures");
    });

    it("should reject refund with zero amount", async function () {
      const nonce = await staking.refundNonces(rentalId);
      const signatures = await signRefundApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        0n,
        nonce
      );

      await expect(
        staking.connect(user1).claimRefund(rentalId, 0n, signatures)
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("should reject refund exceeding available amount", async function () {
      const nonce = await staking.refundNonces(rentalId);
      const excessiveAmount = RENTAL_AMOUNT * 2n;
      const signatures = await signRefundApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        excessiveAmount,
        nonce
      );

      await expect(
        staking.connect(user1).claimRefund(rentalId, excessiveAmount, signatures)
      ).to.be.revertedWithCustomError(staking, "AmountExceedsAvailable");
    });

    it("should allow multiple partial refunds", async function () {
      const halfAmount = RENTAL_AMOUNT / 2n;

      // First refund
      const nonce1 = await staking.refundNonces(rentalId);
      const signatures1 = await signRefundApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        halfAmount,
        nonce1
      );
      await staking.connect(user1).claimRefund(rentalId, halfAmount, signatures1);

      // Second refund
      const nonce2 = await staking.refundNonces(rentalId);
      const signatures2 = await signRefundApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        halfAmount,
        nonce2
      );
      await staking.connect(user1).claimRefund(rentalId, halfAmount, signatures2);

      // Third refund should fail - nothing left
      const nonce3 = await staking.refundNonces(rentalId);
      const signatures3 = await signRefundApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        1n,
        nonce3
      );
      await expect(
        staking.connect(user1).claimRefund(rentalId, 1n, signatures3)
      ).to.be.revertedWithCustomError(staking, "AmountExceedsAvailable");
    });
  });

  describe("Slashing - Type 1: Slash and Ban", function () {
    let rentalId0: string;
    let rentalId1: string;

    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      rentalId0 = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
      rentalId1 = await makeRental(user2, provider1, VM_MEDIUM, RENTAL_DURATION);
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

      // Users can still claim refunds with backend signatures
      const rental0Amount = PRICE_SMALL * RENTAL_DURATION;
      const rental1Amount = PRICE_MEDIUM * RENTAL_DURATION;

      const nonce0 = await staking.refundNonces(rentalId0);
      const signatures0 = await signRefundApproval(
        [signer1, signer2],
        rentalId0,
        user1.address,
        rental0Amount,
        nonce0
      );
      await staking.connect(user1).claimRefund(rentalId0, rental0Amount, signatures0);

      const nonce1 = await staking.refundNonces(rentalId1);
      const signatures1 = await signRefundApproval(
        [signer1, signer2],
        rentalId1,
        user2.address,
        rental1Amount,
        nonce1
      );
      await staking.connect(user2).claimRefund(rentalId1, rental1Amount, signatures1);
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

      // Verify stake is correctly reduced
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
    let rentalId: string;

    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      rentalId = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
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

    it("should return correct rental data", async function () {
      const rental = await staking.getRental(rentalId);
      expect(rental.user).to.equal(user1.address);
      expect(rental.provider).to.equal(provider1.address);
      expect(rental.amount).to.equal(RENTAL_AMOUNT);
      expect(rental.vm).to.equal(VM_SMALL);
    });

    it("should return user rentals", async function () {
      const rentals = await staking.getUserRentals(user1.address);
      expect(rentals.length).to.equal(1);
      expect(rentals[0]).to.equal(rentalId);
    });

    it("should return provider rentals", async function () {
      const rentals = await staking.getProviderRentals(provider1.address);
      expect(rentals.length).to.equal(1);
      expect(rentals[0]).to.equal(rentalId);
    });

    it("should return domain separator", async function () {
      const domainSeparator = await staking.domainSeparator();
      expect(domainSeparator).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("Commission on Withdrawals", function () {
    let rentalId: string;
    const COMMISSION_5_PERCENT = 500n; // 5% in basis points
    const COMMISSION_10_PERCENT = 1000n; // 10% in basis points

    beforeEach(async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      rentalId = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
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

    describe("withdrawRental with commission", function () {
      it("should deduct commission and send to treasury", async function () {
        await staking.connect(admin).setCommission(COMMISSION_5_PERCENT);

        const nonce = await staking.withdrawalNonces(rentalId);
        const signatures = await signWithdrawalApproval(
          [signer1, signer2],
          rentalId,
          provider1.address,
          RENTAL_AMOUNT,
          nonce
        );

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).withdrawRental(rentalId, RENTAL_AMOUNT, signatures);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        // Commission = RENTAL_AMOUNT * 500 / 10000 = 5%
        const expectedCommission = (RENTAL_AMOUNT * COMMISSION_5_PERCENT) / 10000n;
        const expectedProviderAmount = RENTAL_AMOUNT - expectedCommission;

        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedCommission);
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(expectedProviderAmount);
      });

      it("should calculate commission correctly for 10%", async function () {
        await staking.connect(admin).setCommission(COMMISSION_10_PERCENT);

        const nonce = await staking.withdrawalNonces(rentalId);
        const signatures = await signWithdrawalApproval(
          [signer1, signer2],
          rentalId,
          provider1.address,
          RENTAL_AMOUNT,
          nonce
        );

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).withdrawRental(rentalId, RENTAL_AMOUNT, signatures);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        // Commission = RENTAL_AMOUNT * 1000 / 10000 = 10%
        const expectedCommission = (RENTAL_AMOUNT * COMMISSION_10_PERCENT) / 10000n;
        const expectedProviderAmount = RENTAL_AMOUNT - expectedCommission;

        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedCommission);
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(expectedProviderAmount);
      });

      it("should transfer full amount to provider with 0% commission", async function () {
        // Commission defaults to 0
        expect(await staking.commissionBps()).to.equal(0);

        const nonce = await staking.withdrawalNonces(rentalId);
        const signatures = await signWithdrawalApproval(
          [signer1, signer2],
          rentalId,
          provider1.address,
          RENTAL_AMOUNT,
          nonce
        );

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).withdrawRental(rentalId, RENTAL_AMOUNT, signatures);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        // No commission - treasury unchanged
        expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
        // Provider gets full amount
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(RENTAL_AMOUNT);
      });

      it("should transfer full amount to treasury with 100% commission", async function () {
        await staking.connect(admin).setCommission(10000n); // 100%

        const nonce = await staking.withdrawalNonces(rentalId);
        const signatures = await signWithdrawalApproval(
          [signer1, signer2],
          rentalId,
          provider1.address,
          RENTAL_AMOUNT,
          nonce
        );

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).withdrawRental(rentalId, RENTAL_AMOUNT, signatures);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        // Treasury gets full amount
        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(RENTAL_AMOUNT);
        // Provider gets nothing
        expect(providerBalanceAfter).to.equal(providerBalanceBefore);
      });

      it("should handle partial withdrawal with commission", async function () {
        await staking.connect(admin).setCommission(COMMISSION_5_PERCENT);
        const halfAmount = RENTAL_AMOUNT / 2n;

        const nonce = await staking.withdrawalNonces(rentalId);
        const signatures = await signWithdrawalApproval(
          [signer1, signer2],
          rentalId,
          provider1.address,
          halfAmount,
          nonce
        );

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).withdrawRental(rentalId, halfAmount, signatures);

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        const expectedCommission = (halfAmount * COMMISSION_5_PERCENT) / 10000n;
        const expectedProviderAmount = halfAmount - expectedCommission;

        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedCommission);
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(expectedProviderAmount);
      });
    });

    describe("batchWithdrawRental with commission", function () {
      let rentalId2: string;
      let rentalId3: string;

      beforeEach(async function () {
        rentalId2 = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
        rentalId3 = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);
      });

      it("should deduct commission on batch withdrawal", async function () {
        await staking.connect(admin).setCommission(COMMISSION_5_PERCENT);

        const nonce1 = await staking.withdrawalNonces(rentalId);
        const nonce2 = await staking.withdrawalNonces(rentalId2);
        const nonce3 = await staking.withdrawalNonces(rentalId3);

        const signatures1 = await signWithdrawalApproval([signer1, signer2], rentalId, provider1.address, RENTAL_AMOUNT, nonce1);
        const signatures2 = await signWithdrawalApproval([signer1, signer2], rentalId2, provider1.address, RENTAL_AMOUNT, nonce2);
        const signatures3 = await signWithdrawalApproval([signer1, signer2], rentalId3, provider1.address, RENTAL_AMOUNT, nonce3);

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).batchWithdrawRental(
          [rentalId, rentalId2, rentalId3],
          [RENTAL_AMOUNT, RENTAL_AMOUNT, RENTAL_AMOUNT],
          [signatures1, signatures2, signatures3]
        );

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        const totalAmount = RENTAL_AMOUNT * 3n;
        const expectedCommission = (totalAmount * COMMISSION_5_PERCENT) / 10000n;
        const expectedProviderAmount = totalAmount - expectedCommission;

        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedCommission);
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(expectedProviderAmount);
      });

      it("should handle batch withdrawal with 0% commission", async function () {
        // Commission defaults to 0
        const nonce1 = await staking.withdrawalNonces(rentalId);
        const nonce2 = await staking.withdrawalNonces(rentalId2);

        const signatures1 = await signWithdrawalApproval([signer1, signer2], rentalId, provider1.address, RENTAL_AMOUNT, nonce1);
        const signatures2 = await signWithdrawalApproval([signer1, signer2], rentalId2, provider1.address, RENTAL_AMOUNT, nonce2);

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).batchWithdrawRental(
          [rentalId, rentalId2],
          [RENTAL_AMOUNT, RENTAL_AMOUNT],
          [signatures1, signatures2]
        );

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        // No commission - treasury unchanged
        expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
        // Provider gets full amount
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(RENTAL_AMOUNT * 2n);
      });

      it("should handle batch withdrawal with 100% commission", async function () {
        await staking.connect(admin).setCommission(10000n); // 100%

        const nonce1 = await staking.withdrawalNonces(rentalId);
        const nonce2 = await staking.withdrawalNonces(rentalId2);

        const signatures1 = await signWithdrawalApproval([signer1, signer2], rentalId, provider1.address, RENTAL_AMOUNT, nonce1);
        const signatures2 = await signWithdrawalApproval([signer1, signer2], rentalId2, provider1.address, RENTAL_AMOUNT, nonce2);

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).batchWithdrawRental(
          [rentalId, rentalId2],
          [RENTAL_AMOUNT, RENTAL_AMOUNT],
          [signatures1, signatures2]
        );

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        // Treasury gets full amount
        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(RENTAL_AMOUNT * 2n);
        // Provider gets nothing
        expect(providerBalanceAfter).to.equal(providerBalanceBefore);
      });

      it("should handle partial batch withdrawal with commission", async function () {
        await staking.connect(admin).setCommission(COMMISSION_10_PERCENT);
        const halfAmount = RENTAL_AMOUNT / 2n;

        const nonce1 = await staking.withdrawalNonces(rentalId);
        const nonce2 = await staking.withdrawalNonces(rentalId2);

        const signatures1 = await signWithdrawalApproval([signer1, signer2], rentalId, provider1.address, halfAmount, nonce1);
        const signatures2 = await signWithdrawalApproval([signer1, signer2], rentalId2, provider1.address, halfAmount, nonce2);

        const treasuryBalanceBefore = await tlpToken.balanceOf(treasury.address);
        const providerBalanceBefore = await tlpToken.balanceOf(provider1.address);

        await staking.connect(provider1).batchWithdrawRental(
          [rentalId, rentalId2],
          [halfAmount, halfAmount],
          [signatures1, signatures2]
        );

        const treasuryBalanceAfter = await tlpToken.balanceOf(treasury.address);
        const providerBalanceAfter = await tlpToken.balanceOf(provider1.address);

        const totalAmount = halfAmount * 2n;
        const expectedCommission = (totalAmount * COMMISSION_10_PERCENT) / 10000n;
        const expectedProviderAmount = totalAmount - expectedCommission;

        expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedCommission);
        expect(providerBalanceAfter - providerBalanceBefore).to.equal(expectedProviderAmount);
      });
    });
  });

  describe("Edge Cases", function () {
    it("should handle provider withdrawal of partial rental after partial refund", async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      const rentalId = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);

      const refundAmount = RENTAL_AMOUNT / 2n;

      // User claims partial refund
      const refundNonce = await staking.refundNonces(rentalId);
      const refundSignatures = await signRefundApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        refundAmount,
        refundNonce
      );
      await staking.connect(user1).claimRefund(rentalId, refundAmount, refundSignatures);

      // Provider withdraws remaining
      const withdrawNonce = await staking.withdrawalNonces(rentalId);
      const remainingAmount = RENTAL_AMOUNT - refundAmount;
      const withdrawSignatures = await signWithdrawalApproval(
        [signer1, signer2],
        rentalId,
        provider1.address,
        remainingAmount,
        withdrawNonce
      );

      const balanceBefore = await tlpToken.balanceOf(provider1.address);
      await staking.connect(provider1).withdrawRental(rentalId, remainingAmount, withdrawSignatures);
      const balanceAfter = await tlpToken.balanceOf(provider1.address);

      expect(balanceAfter - balanceBefore).to.equal(remainingAmount);

      // Verify rental is fully processed
      const rental = await staking.getRental(rentalId);
      expect(rental.withdrawnAmount).to.equal(remainingAmount);
      expect(rental.refundedAmount).to.equal(refundAmount);
    });

    it("should handle 3-of-3 signature requirement for all operations", async function () {
      await staking.connect(admin).setRequiredRentalSignatures(3);
      await staking.connect(admin).setRequiredWithdrawalSignatures(3);
      await staking.connect(admin).setRequiredRefundSignatures(3);
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);

      // Rental with 3 signatures
      const rentalId = generateRentalId();
      const rentalNonce = await staking.rentalNonces(user1.address);
      const rentalSignatures = await signRentalApproval(
        [signer1, signer2, signer3],
        rentalId,
        user1.address,
        provider1.address,
        VM_SMALL,
        RENTAL_DURATION,
        rentalNonce
      );
      await staking.connect(user1).rentFromProvider(rentalId, provider1.address, VM_SMALL, RENTAL_DURATION, rentalSignatures);

      // Withdrawal with 3 signatures
      const withdrawNonce = await staking.withdrawalNonces(rentalId);
      const withdrawSignatures = await signWithdrawalApproval(
        [signer1, signer2, signer3],
        rentalId,
        provider1.address,
        RENTAL_AMOUNT,
        withdrawNonce
      );

      await expect(staking.connect(provider1).withdrawRental(rentalId, RENTAL_AMOUNT, withdrawSignatures))
        .to.emit(staking, "RentalWithdrawn");
    });

    it("should prevent withdrawal after full refund", async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      const rentalId = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);

      // User gets full refund
      const refundNonce = await staking.refundNonces(rentalId);
      const refundSignatures = await signRefundApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        RENTAL_AMOUNT,
        refundNonce
      );
      await staking.connect(user1).claimRefund(rentalId, RENTAL_AMOUNT, refundSignatures);

      // Provider tries to withdraw - should fail
      const withdrawNonce = await staking.withdrawalNonces(rentalId);
      const withdrawSignatures = await signWithdrawalApproval(
        [signer1, signer2],
        rentalId,
        provider1.address,
        1n,
        withdrawNonce
      );

      await expect(
        staking.connect(provider1).withdrawRental(rentalId, 1n, withdrawSignatures)
      ).to.be.revertedWithCustomError(staking, "AmountExceedsAvailable");
    });

    it("should prevent refund after full withdrawal", async function () {
      await staking.connect(provider1).stake(STAKE_AMOUNT, MIN_STAKE_DURATION);
      const rentalId = await makeRental(user1, provider1, VM_SMALL, RENTAL_DURATION);

      // Provider withdraws full amount
      const withdrawNonce = await staking.withdrawalNonces(rentalId);
      const withdrawSignatures = await signWithdrawalApproval(
        [signer1, signer2],
        rentalId,
        provider1.address,
        RENTAL_AMOUNT,
        withdrawNonce
      );
      await staking.connect(provider1).withdrawRental(rentalId, RENTAL_AMOUNT, withdrawSignatures);

      // User tries to get refund - should fail
      const refundNonce = await staking.refundNonces(rentalId);
      const refundSignatures = await signRefundApproval(
        [signer1, signer2],
        rentalId,
        user1.address,
        1n,
        refundNonce
      );

      await expect(
        staking.connect(user1).claimRefund(rentalId, 1n, refundSignatures)
      ).to.be.revertedWithCustomError(staking, "AmountExceedsAvailable");
    });
  });
});
