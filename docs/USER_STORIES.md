# User Stories

This document describes the user flows for each actor in the TLPStaking system.

## Actors

| Actor | Description |
|-------|-------------|
| **Provider** | Compute resource provider who stakes TLP tokens and offers VMs |
| **User** | Consumer who rents VM resources from providers |
| **Admin** | System administrator who manages signers and configuration |
| **Police** | Authorized role that can slash misbehaving providers |
| **Signer** | Backend service that authorizes transactions via EIP712 signatures |

---

## Provider Stories

### US-P1: Register as a Provider

**As a** compute provider  
**I want to** stake TLP tokens  
**So that** I can offer VM resources on the marketplace

**Acceptance Criteria:**
- Provider approves TLP token spending to the contract
- Provider calls `stake(amount, duration)` with minimum 30 days duration
- Provider's stake is locked until unlock time
- Provider can now receive rental requests

**Flow:**
```
1. Provider approves TLP spending: tlpToken.approve(stakingContract, amount)
2. Provider stakes: staking.stake(10000 TLP, 30 days)
3. Event emitted: Staked(provider, 10000 TLP, unlockTime)
4. Provider is now active and can receive rentals
```

---

### US-P2: Extend Stake Duration

**As a** provider  
**I want to** extend my stake lock period  
**So that** users have more confidence in my commitment

**Acceptance Criteria:**
- New unlock time must be at least minStakeDuration from now
- New unlock time must be later than current unlock time

**Flow:**
```
1. Provider calls: staking.extendStakeDuration(newUnlockTime)
2. Event emitted: StakeExtended(provider, newUnlockTime)
```

---

### US-P3: Increase Stake

**As a** provider  
**I want to** add more tokens to my stake  
**So that** I can increase user trust and handle more rentals

**Acceptance Criteria:**
- Additional tokens are transferred to contract
- Stake duration is extended by minStakeDuration if needed

**Flow:**
```
1. Provider approves additional TLP
2. Provider calls: staking.increaseStake(5000 TLP)
3. Event emitted: StakeIncreased(provider, 5000 TLP, 15000 TLP, newUnlockTime)
```

---

### US-P4: Withdraw Rental Earnings

**As a** provider  
**I want to** withdraw my earnings from completed rentals  
**So that** I receive payment for services rendered

**Acceptance Criteria:**
- Provider must have valid EIP712 signatures from backend signers
- Amount must not exceed available balance (original - already withdrawn - refunded)
- Partial withdrawals are supported

**Flow:**
```
1. Provider requests withdrawal approval from backend
2. Backend validates service delivery
3. Backend signers create EIP712 signatures for withdrawal
4. Provider calls: staking.withdrawRental(rentalId, amount, signatures)
5. Event emitted: RentalWithdrawn(provider, rentalId, amount)
6. TLP tokens transferred to provider
```

---

### US-P5: Withdraw Stake

**As a** provider  
**I want to** withdraw my staked tokens  
**So that** I can exit the marketplace

**Acceptance Criteria:**
- Current time must be past unlock time
- Full stake amount is returned

**Flow:**
```
1. Wait until block.timestamp >= unlockTime
2. Provider calls: staking.withdrawStake()
3. Event emitted: StakeWithdrawn(provider, amount)
4. Provider is no longer active
```

---

## User Stories

### US-U1: Rent VM Resources

**As a** user  
**I want to** rent VM compute resources from a provider  
**So that** I can run my workloads

**Acceptance Criteria:**
- Provider must be active (staked and not banned)
- VM type must have configured pricing
- User must have valid EIP712 signatures from backend
- Payment amount = pricePerSecond × duration

**Flow:**
```
1. User selects provider and VM type on frontend
2. Backend generates unique rentalId (bytes32) and creates EIP712 signatures
3. User approves TLP spending
4. User calls: staking.rentFromProvider(rentalId, provider, vmId, duration, signatures)
5. Event emitted: RentalCreated(user, provider, rentalId, amount, vm, duration)
6. User can now use the VM (backend tracks by rentalId)
```

---

### US-U2: Claim Refund

**As a** user  
**I want to** claim a refund for unused resources  
**So that** I get my tokens back when service is not delivered

**Acceptance Criteria:**
- User must have valid EIP712 signatures from backend
- Refund amount must not exceed available balance
- Partial refunds are supported

**Flow:**
```
1. User requests refund from backend (service issue, early termination, etc.)
2. Backend validates refund eligibility
3. Backend signers create EIP712 signatures for refund amount
4. User calls: staking.claimRefund(rentalId, amount, signatures)
5. Event emitted: RefundClaimed(user, provider, rentalId, amount)
6. TLP tokens transferred to user
```

---

## Admin Stories

### US-A1: Configure VM Pricing

**As an** admin  
**I want to** set prices for different VM types  
**So that** users know the cost of resources

**Acceptance Criteria:**
- Only admin can set prices
- Price is per second in TLP tokens
- Setting price to 0 disables the VM type

**Flow:**
```
1. Admin calls: staking.setVmPrice(vmId, pricePerSecond)
2. Event emitted: VmPriceUpdated(vm, oldPrice, newPrice)
```

---

### US-A2: Manage Signers

**As an** admin  
**I want to** add or remove authorized signers  
**So that** I can control who can authorize transactions

**Acceptance Criteria:**
- Only admin can add/remove signers
- Cannot add duplicate signers
- Removing signer adjusts required signatures if needed

**Flow:**
```
1. Admin calls: staking.addSigner(signerAddress)
2. Event emitted: SignerAdded(signer)
3. Signer can now participate in k-of-n signatures
```

---

### US-A3: Configure Signature Requirements

**As an** admin  
**I want to** set different signature requirements per action  
**So that** I can balance security and operational efficiency

**Acceptance Criteria:**
- Can set different k values for rentals, withdrawals, and refunds
- k must be > 0 and <= number of signers

**Flow:**
```
1. Admin calls: staking.setRequiredRentalSignatures(1)      // Low risk
2. Admin calls: staking.setRequiredWithdrawalSignatures(2)  // Medium risk
3. Admin calls: staking.setRequiredRefundSignatures(2)      // Medium risk
```

---

## Police Stories

### US-PO1: Slash and Ban Provider

**As a** police officer  
**I want to** slash a misbehaving provider and ban them  
**So that** users are protected from bad actors

**Acceptance Criteria:**
- Full stake is transferred to treasury
- Provider is banned from future staking
- Provider cannot receive new rentals

**Flow:**
```
1. Police detects malicious behavior
2. Police calls: staking.slashAndBan(provider)
3. Event emitted: ProviderSlashed(provider, slashedAmount, true)
4. Stake transferred to treasury
5. Backend can now sign refunds for affected users
```

---

### US-PO2: Partial Slash

**As a** police officer  
**I want to** slash part of a provider's stake  
**So that** I can penalize minor infractions without full ban

**Acceptance Criteria:**
- Specified amount is slashed
- Provider remains active
- Provider can continue receiving rentals

**Flow:**
```
1. Police detects minor infraction
2. Police calls: staking.slashPartial(provider, slashAmount)
3. Event emitted: ProviderSlashed(provider, slashAmount, false)
4. Partial stake transferred to treasury
```

---

### US-PO3: Unban Provider

**As an** admin  
**I want to** unban a previously banned provider  
**So that** they can return to the marketplace after reform

**Acceptance Criteria:**
- Provider must be currently banned
- Provider can stake again after unbanning

**Flow:**
```
1. Admin reviews provider's appeal
2. Admin calls: staking.unbanProvider(provider)
3. Event emitted: ProviderUnbanned(provider)
4. Provider can stake again
```

---

## Backend Signer Stories

### US-S1: Authorize Rental

**As a** backend signer
**I want to** sign rental approvals
**So that** validated users can rent resources

**Acceptance Criteria:**
- Generate unique rentalId (bytes32) for tracking
- Verify user has sufficient TLP balance
- Verify provider is active and not overbooked
- Create EIP712 signature with correct nonce

**Signature Data:**
```typescript
{
  rentalId: "0x...",     // bytes32 unique ID generated by backend
  user: "0x...",
  provider: "0x...",
  vm: "0x...",           // bytes32 VM identifier
  duration: 3600,        // seconds
  nonce: 0               // per-user nonce
}
```

---

### US-S2: Authorize Withdrawal

**As a** backend signer  
**I want to** sign withdrawal approvals  
**So that** providers receive payment for completed services

**Acceptance Criteria:**
- Verify service was delivered
- Calculate correct withdrawal amount
- Use correct per-rental withdrawal nonce

**Signature Data:**
```typescript
{
  rentalId: 0,
  provider: "0x...",
  amount: 1000000000000000000n,  // in wei
  nonce: 0                       // per-rental nonce
}
```

---

### US-S3: Authorize Refund

**As a** backend signer  
**I want to** sign refund approvals  
**So that** users can recover funds for failed services

**Acceptance Criteria:**
- Verify refund is justified (SLA violation, early termination, etc.)
- Calculate correct refund amount
- Use correct per-rental refund nonce

**Signature Data:**
```typescript
{
  rentalId: 0,
  user: "0x...",
  amount: 500000000000000000n,  // in wei
  nonce: 0                      // per-rental nonce
}
```

---

## Combined Flow Example

### Complete Rental Lifecycle

```
Timeline:
─────────────────────────────────────────────────────────────────────────►

1. Provider Stakes
   └─► stake(10000 TLP, 30 days)

2. Admin Configures
   └─► setVmPrice("vm.small", 0.001 TLP/sec)

3. User Rents (1 hour = 3.6 TLP)
   └─► Backend generates rentalId (bytes32 UUID)
   └─► Backend signs rental approval with rentalId
   └─► rentFromProvider(rentalId, provider, "vm.small", 3600, [sig1, sig2])
   └─► Rental created with 3.6 TLP locked, tracked by rentalId

4. Scenario A: Full Service Delivery
   └─► Backend verifies completion
   └─► Backend signs withdrawal for 3.6 TLP
   └─► Provider: withdrawRental(rentalId, 3.6 TLP, [sig1, sig2])
   └─► Provider receives 3.6 TLP

4. Scenario B: Partial Service (30 min used)
   └─► Backend signs withdrawal for 1.8 TLP
   └─► Provider: withdrawRental(rentalId, 1.8 TLP, [sig1, sig2])
   └─► Backend signs refund for 1.8 TLP
   └─► User: claimRefund(rentalId, 1.8 TLP, [sig1, sig2])

4. Scenario C: Service Failure
   └─► Backend signs full refund for 3.6 TLP
   └─► User: claimRefund(rentalId, 3.6 TLP, [sig1, sig2])
   └─► User receives full 3.6 TLP back
```
