# TypeScript Client Library

Complete guide for using the TLPStaking TypeScript client library.

## Installation

The client library is included in the `src/client/` directory. Import it directly:

```typescript
import {
  TLPStakingClient,
  TLPStakingSigner,
  encodeVmId,
  decodeVmId,
} from "./src/client";
```

## Quick Start

```typescript
import { ethers } from "ethers";
import { TLPStakingClient, TLPStakingSigner } from "./src/client";

// Connect to provider
const provider = new ethers.JsonRpcProvider("https://rpc.example.com");
const wallet = new ethers.Wallet(privateKey, provider);

// Create client
const client = new TLPStakingClient(provider, contractAddress);

// Read data
const balance = await client.getUserBalance(userAddress);
console.log(`User balance: ${ethers.formatEther(balance)} TLP`);

// Create signer for EIP712 signatures
const signer = await client.createSigner(wallet);
```

## TLPStakingClient

The main client for interacting with the TLPStaking contract.

### Constructor

```typescript
const client = new TLPStakingClient(
  providerOrSigner,  // ethers Provider or Signer
  contractAddress    // Contract address string
);
```

### Read Methods

#### User Balance Queries

```typescript
// Get user's pool balance
const balance = await client.getUserBalance(userAddress);
console.log(`Balance: ${ethers.formatEther(balance)} TLP`);

// Get current nonce for an address
const nonce = await client.getNonce(userAddress);
```

#### Provider Queries

```typescript
// Get provider info
const info = await client.getProviderInfo(providerAddress);
console.log(`Stake: ${info.stakeAmount}`);
console.log(`Unlock: ${new Date(Number(info.unlockTime) * 1000)}`);
console.log(`Banned: ${info.isBanned}`);
console.log(`Slash count: ${info.slashCount}`);

// Check if provider is active
const isActive = await client.isProviderActive(providerAddress);
```

#### Signer Queries

```typescript
// Get all signers
const signers = await client.getSigners();

// Get signer count
const count = await client.getSignerCount();

// Check if address is signer
const isSigner = await client.isSigner(address);

// Get required signatures
const required = await client.getRequiredSignatures();
```

#### Configuration Queries

```typescript
// Get min stake duration
const minDuration = await client.getMinStakeDuration();

// Get commission rate (basis points)
const commissionBps = await client.getCommissionBps();

// Get treasury address
const treasury = await client.getTreasury();

// Get TLP token address
const token = await client.getTlpToken();

// Get EIP712 domain separator
const domainSeparator = await client.getDomainSeparator();
```

### Write Methods

#### User Operations

```typescript
// Connect with signer for write operations
const clientWithSigner = client.connect(wallet);

// Deposit to pool (no signature needed)
const depositTx = await clientWithSigner.deposit(ethers.parseEther("100"));
await depositTx.wait();

// Withdraw from pool (requires signatures)
const withdrawTx = await clientWithSigner.withdraw(
  ethers.parseEther("50"),  // amount
  deadline,                  // expiration timestamp
  signatures                 // k-of-n signatures
);
await withdrawTx.wait();
```

#### Provider Operations

```typescript
// Stake 10,000 TLP for 30 days
const tx1 = await clientWithSigner.stake(
  ethers.parseEther("10000"),
  30n * 24n * 60n * 60n  // 30 days in seconds
);
await tx1.wait();

// Extend stake duration
const newUnlockTime = BigInt(Math.floor(Date.now() / 1000)) + 60n * 24n * 60n * 60n;
const tx2 = await clientWithSigner.extendStakeDuration(newUnlockTime);

// Increase stake
const tx3 = await clientWithSigner.increaseStake(ethers.parseEther("5000"));

// Withdraw stake (after unlock)
const tx4 = await clientWithSigner.withdrawStake();
```

#### Provider Claim Operations

```typescript
// Claim from user's balance (requires signatures)
const claimTx = await clientWithSigner.claim(
  rentalId,      // bytes32 for audit trail
  userAddress,   // user to claim from
  claimAmount,   // amount to claim
  deadline,      // signature expiration
  signatures     // k-of-n signatures
);
await claimTx.wait();

// Batch claim from multiple users (more gas efficient)
const claims = [
  { rentalId: rental1, user: user1, amount: amount1, deadline },
  { rentalId: rental2, user: user2, amount: amount2, deadline },
];
const batchTx = await clientWithSigner.batchClaim(
  claims,
  [signatures1, signatures2]
);
```

#### Admin Operations

```typescript
// Add signer (admin only)
await clientWithSigner.addSigner(signerAddress);

// Remove signer
await clientWithSigner.removeSigner(signerAddress);

// Set required signatures
await clientWithSigner.setRequiredSignatures(2n);

// Set commission (500 = 5%)
await clientWithSigner.setCommission(500n);

// Set min stake duration
await clientWithSigner.setMinStakeDuration(45n * 24n * 60n * 60n);

// Set treasury
await clientWithSigner.setTreasury(newTreasuryAddress);
```

#### Police Operations

```typescript
// Slash and ban (police only)
await clientWithSigner.slashAndBan(providerAddress);

// Partial slash
await clientWithSigner.slashPartial(providerAddress, slashAmount);

// Unban (police only)
await clientWithSigner.unbanProvider(providerAddress);
```

## TLPStakingSigner

Helper class for creating EIP712 signatures.

### Constructor

```typescript
// Create directly
const signer = new TLPStakingSigner(
  ethersWallet,      // Ethers Signer
  contractAddress,   // Contract address
  chainId           // Chain ID as bigint
);

// Or from client
const signer = await client.createSigner(ethersWallet);

// Or using static method
const signer = await TLPStakingSigner.fromSigner(ethersWallet, contractAddress);
```

### Sign Withdrawal

```typescript
const signature = await signer.signWithdrawal({
  user: userAddress,
  amount: ethers.parseEther("50"),
  nonce: 0n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour
});
```

### Sign Claim

```typescript
const signature = await signer.signClaim({
  rentalId: "0x0123456789abcdef...",  // bytes32 for audit trail
  user: userAddress,
  provider: providerAddress,
  amount: ethers.parseEther("10"),
  nonce: 0n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
});
```

### Collect Multiple Signatures

```typescript
// Collect signatures from multiple signers
const signers = [signer1, signer2, signer3];

const signatures = await TLPStakingSigner.collectSignatures(
  signers,
  (s) => s.signWithdrawal({
    user: userAddress,
    amount: ethers.parseEther("50"),
    nonce: 0n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  })
);
```

## Utility Functions

### VM ID Encoding

```typescript
import { encodeVmId, decodeVmId } from "./src/client";

// Encode VM name to bytes32
const vmId = encodeVmId("vm.small");

// Decode bytes32 to VM name
const vmName = decodeVmId(vmId);
```

### Duration Formatting

```typescript
import { formatDuration } from "./src/client";

// Format seconds to human-readable
console.log(formatDuration(3600));     // "1 hour"
console.log(formatDuration(86400));    // "1 day"
console.log(formatDuration(90061));    // "1 day 1 hour 1 minute 1 second"
```

### Time Calculations

```typescript
import {
  calculateUnlockTime,
  isStakeLocked,
  timeUntilUnlock,
  secondsToDays,
  daysToSeconds,
} from "./src/client";

// Calculate unlock time from duration
const unlockTime = calculateUnlockTime(30 * 24 * 60 * 60);  // 30 days from now

// Check if stake is locked
const isLocked = isStakeLocked(unlockTime);

// Get remaining time
const remaining = timeUntilUnlock(unlockTime);

// Convert between days and seconds
const days = secondsToDays(2592000n);  // 30
const seconds = daysToSeconds(30);      // 2592000n
```

## Type Definitions

### ProviderInfo

```typescript
interface ProviderInfo {
  stakeAmount: bigint;
  unlockTime: bigint;
  isBanned: boolean;
  slashCount: bigint;
}
```

### ClaimRequest

```typescript
interface ClaimRequest {
  rentalId: string;   // bytes32 for audit trail
  user: string;
  amount: bigint;
  deadline: bigint;
}
```

### WithdrawalData

```typescript
interface WithdrawalData {
  user: string;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}
```

### ClaimData

```typescript
interface ClaimData {
  rentalId: string;   // bytes32 for audit trail
  user: string;
  provider: string;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}
```

### Event Types

```typescript
interface DepositedEvent {
  user: string;
  amount: bigint;
  newBalance: bigint;
}

interface WithdrawnEvent {
  user: string;
  amount: bigint;
  newBalance: bigint;
}

interface ClaimedEvent {
  rentalId: string;
  user: string;
  provider: string;
  amount: bigint;
  commission: bigint;
}
```

## Complete Examples

### Provider Registration Flow

```typescript
import { ethers } from "ethers";
import { TLPStakingClient } from "./src/client";

async function registerProvider() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PROVIDER_KEY, provider);

  const client = new TLPStakingClient(provider, CONTRACT_ADDRESS);
  const clientWithSigner = client.connect(wallet);

  // First approve TLP spending
  const tlpToken = new ethers.Contract(TLP_ADDRESS, ERC20_ABI, wallet);
  const stakeAmount = ethers.parseEther("10000");
  await tlpToken.approve(CONTRACT_ADDRESS, stakeAmount);

  // Then stake
  const stakeDuration = 30n * 24n * 60n * 60n; // 30 days
  const tx = await clientWithSigner.stake(stakeAmount, stakeDuration);
  await tx.wait();

  console.log("Provider registered successfully!");
}
```

### Backend Signing Service

```typescript
import { ethers } from "ethers";
import { TLPStakingSigner } from "./src/client";

class SigningService {
  private signers: TLPStakingSigner[];

  constructor(
    wallets: ethers.Wallet[],
    contractAddress: string,
    chainId: bigint
  ) {
    this.signers = wallets.map(
      w => new TLPStakingSigner(w, contractAddress, chainId)
    );
  }

  async signWithdrawal(
    user: string,
    amount: bigint,
    nonce: bigint,
    deadline: bigint
  ): Promise<string[]> {
    return TLPStakingSigner.collectSignatures(
      this.signers,
      (s) => s.signWithdrawal({ user, amount, nonce, deadline })
    );
  }

  async signClaim(
    rentalId: string,
    user: string,
    provider: string,
    amount: bigint,
    nonce: bigint,
    deadline: bigint
  ): Promise<string[]> {
    return TLPStakingSigner.collectSignatures(
      this.signers,
      (s) => s.signClaim({ rentalId, user, provider, amount, nonce, deadline })
    );
  }
}
```

### User Deposit and Withdrawal Flow

```typescript
import { ethers } from "ethers";
import { TLPStakingClient } from "./src/client";

async function userFlow(
  userWallet: ethers.Wallet,
  signingService: SigningService
) {
  const client = new TLPStakingClient(userWallet.provider!, CONTRACT_ADDRESS);
  const clientWithSigner = client.connect(userWallet);

  // Deposit to pool
  const depositAmount = ethers.parseEther("100");
  const tlpToken = new ethers.Contract(TLP_ADDRESS, ERC20_ABI, userWallet);
  await tlpToken.approve(CONTRACT_ADDRESS, depositAmount);

  const depositTx = await clientWithSigner.deposit(depositAmount);
  await depositTx.wait();
  console.log("Deposited 100 TLP to pool");

  // Check balance
  const balance = await client.getUserBalance(userWallet.address);
  console.log(`Pool balance: ${ethers.formatEther(balance)} TLP`);

  // Later: withdraw with signatures
  const withdrawAmount = ethers.parseEther("50");
  const nonce = await client.getNonce(userWallet.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const signatures = await signingService.signWithdrawal(
    userWallet.address,
    withdrawAmount,
    nonce,
    deadline
  );

  const withdrawTx = await clientWithSigner.withdraw(
    withdrawAmount,
    deadline,
    signatures
  );
  await withdrawTx.wait();
  console.log("Withdrew 50 TLP from pool");
}
```

### Provider Claim Flow

```typescript
import { ethers } from "ethers";
import { TLPStakingClient } from "./src/client";

async function providerClaimFlow(
  providerWallet: ethers.Wallet,
  signingService: SigningService,
  userAddress: string,
  rentalId: string,
  claimAmount: bigint
) {
  const client = new TLPStakingClient(providerWallet.provider!, CONTRACT_ADDRESS);
  const clientWithSigner = client.connect(providerWallet);

  // Get provider's current nonce
  const nonce = await client.getNonce(providerWallet.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  // Get signatures from backend
  const signatures = await signingService.signClaim(
    rentalId,
    userAddress,
    providerWallet.address,
    claimAmount,
    nonce,
    deadline
  );

  // Submit claim
  const claimTx = await clientWithSigner.claim(
    rentalId,
    userAddress,
    claimAmount,
    deadline,
    signatures
  );
  const receipt = await claimTx.wait();

  // Parse event to get commission
  const claimedEvent = client.parseClaimedEvent(receipt!.logs);
  if (claimedEvent) {
    console.log(`Claimed ${ethers.formatEther(claimedEvent.amount)} TLP`);
    console.log(`Commission: ${ethers.formatEther(claimedEvent.commission)} TLP`);
  }
}
```

### Migration Scenario Example

```typescript
import { ethers } from "ethers";
import { TLPStakingClient } from "./src/client";

async function migrationScenario(
  providerAWallet: ethers.Wallet,
  providerBWallet: ethers.Wallet,
  userAddress: string,
  signingService: SigningService
) {
  const client = new TLPStakingClient(providerAWallet.provider!, CONTRACT_ADDRESS);

  // Provider A claims for service delivered before downtime
  const rentalId1 = ethers.encodeBytes32String("rental-001");
  const amount1 = ethers.parseEther("30");
  const nonce1 = await client.getNonce(providerAWallet.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const sigs1 = await signingService.signClaim(
    rentalId1, userAddress, providerAWallet.address, amount1, nonce1, deadline
  );

  const clientA = client.connect(providerAWallet);
  await clientA.claim(rentalId1, userAddress, amount1, deadline, sigs1);
  console.log("Provider A claimed 30 TLP for pre-downtime service");

  // Provider B claims for continued service after migration
  const rentalId2 = ethers.encodeBytes32String("rental-002");
  const amount2 = ethers.parseEther("40");
  const nonce2 = await client.getNonce(providerBWallet.address);

  const sigs2 = await signingService.signClaim(
    rentalId2, userAddress, providerBWallet.address, amount2, nonce2, deadline
  );

  const clientB = client.connect(providerBWallet);
  await clientB.claim(rentalId2, userAddress, amount2, deadline, sigs2);
  console.log("Provider B claimed 40 TLP for post-migration service");

  // User's remaining balance
  const remaining = await client.getUserBalance(userAddress);
  console.log(`User's remaining balance: ${ethers.formatEther(remaining)} TLP`);
}
```
