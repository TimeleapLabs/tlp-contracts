# TLPStaking Interaction Flowcharts

This document contains Mermaid flowcharts illustrating the various user, provider, and system interactions with the TLPStaking smart contracts.

## 1. User Rents a VM

Complete flow from user request through CLI, backend signature generation, and on-chain execution.

```mermaid
sequenceDiagram
    participant User
    participant CLI as Timeleap CLI
    participant Backend as Timeleap Backend
    participant Contract as TLPStaking Contract
    participant Provider

    User->>CLI: Request to rent VM (type, duration)
    CLI->>Backend: Find available provider for VM type
    Backend->>Contract: Query providers (stake, unlockTime, isBanned)
    Contract-->>Backend: Provider list with status
    Backend->>Backend: Select best provider<br/>(sufficient stake duration, not banned)
    Backend-->>CLI: Provider match found

    CLI->>Backend: Request rental approval
    Backend->>Backend: Generate unique rentalId
    Backend->>Backend: Get user's current nonce
    Backend->>Backend: Create EIP712 RentalApproval<br/>{rentalId, user, provider, vm, duration, nonce}
    Backend->>Backend: Sign with k-of-n signers (2 of 3)
    Backend-->>CLI: Return signatures + rentalId

    CLI->>User: Show rental cost (vmPricePerSecond × duration)
    User->>Contract: approve(stakingContract, amount)
    User->>Contract: rentFromProvider(rentalId, provider, vm, duration, signatures)

    Contract->>Contract: Verify signatures (k-of-n)
    Contract->>Contract: Check rental doesn't exist
    Contract->>Contract: Check VM price configured
    Contract->>Contract: Check provider active & not banned
    Contract->>Contract: Check provider stake duration covers rental + grace
    Contract->>Contract: Transfer TLP from user
    Contract->>Contract: Create Rental record
    Contract-->>User: RentalCreated event

    CLI->>Backend: Submit tx hash for verification
    Backend->>Contract: Verify transaction success
    Backend-->>CLI: Rental confirmed
    CLI->>Provider: Notify: provision VM for user
    Provider-->>User: VM access credentials
```

## 2. Provider Registration (Staking)

How a provider stakes TLP to become active in the marketplace.

```mermaid
sequenceDiagram
    participant Provider
    participant CLI as Timeleap CLI
    participant Contract as TLPStaking Contract
    participant Marketplace

    Provider->>CLI: Register as provider
    CLI->>CLI: Determine stake amount & duration
    CLI->>Provider: Show requirements<br/>(min 30 days stake)

    Provider->>Contract: approve(stakingContract, stakeAmount)
    Provider->>Contract: stake(amount, duration)

    Contract->>Contract: Check not already staked
    Contract->>Contract: Check not banned
    Contract->>Contract: Check duration >= minStakeDuration
    Contract->>Contract: Transfer TLP from provider
    Contract->>Contract: Create ProviderInfo<br/>{stakeAmount, unlockTime, isBanned=false}
    Contract-->>Provider: Staked event

    CLI->>Marketplace: Register provider in marketplace
    Marketplace-->>Provider: Provider now active<br/>Can receive rental requests
```

## 3. Provider Withdraws Earnings

Provider claims tokens for delivered services.

```mermaid
sequenceDiagram
    participant Provider
    participant CLI as Timeleap CLI
    participant Backend as Timeleap Backend
    participant Contract as TLPStaking Contract

    Provider->>CLI: Request withdrawal for rental
    CLI->>Backend: Verify service delivery

    Backend->>Backend: Check service metrics
    Backend->>Backend: Calculate withdrawal amount<br/>(based on actual service delivered)
    Backend->>Backend: Get current withdrawalNonces[rentalId]
    Backend->>Backend: Create EIP712 WithdrawalApproval<br/>{rentalId, provider, amount, nonce}
    Backend->>Backend: Sign with k-of-n signers
    Backend-->>CLI: Return signatures

    Provider->>Contract: withdrawRental(rentalId, amount, signatures)

    Contract->>Contract: Verify provider is rental recipient
    Contract->>Contract: Verify signatures
    Contract->>Contract: Check amount <= available balance
    Contract->>Contract: Transfer TLP to provider
    Contract->>Contract: Update withdrawnAmount
    Contract-->>Provider: RentalWithdrawn event
```

## 4. User Claims Refund

User gets tokens back for failed or partial service.

```mermaid
sequenceDiagram
    participant User
    participant CLI as Timeleap CLI
    participant Backend as Timeleap Backend
    participant Contract as TLPStaking Contract

    User->>CLI: Request refund (service issue)
    CLI->>Backend: Submit refund request with reason

    Backend->>Backend: Validate refund eligibility<br/>(SLA violation, downtime, etc.)
    Backend->>Backend: Calculate refund amount
    Backend->>Backend: Get current refundNonces[rentalId]
    Backend->>Backend: Create EIP712 RefundApproval<br/>{rentalId, user, amount, nonce}
    Backend->>Backend: Sign with k-of-n signers
    Backend-->>CLI: Return signatures + approved amount

    CLI->>User: Show approved refund amount
    User->>Contract: claimRefund(rentalId, amount, signatures)

    Contract->>Contract: Verify user is original renter
    Contract->>Contract: Verify signatures
    Contract->>Contract: Check amount <= available balance
    Contract->>Contract: Transfer TLP to user
    Contract->>Contract: Update refundedAmount
    Contract-->>User: RefundClaimed event
```

## 5. Provider Misbehavior & Slashing

Police enforcement when a provider fails to deliver or commits fraud.

```mermaid
sequenceDiagram
    participant Provider
    participant Monitor as Monitoring System
    participant Police as Police (POLICE_ROLE)
    participant Contract as TLPStaking Contract
    participant Treasury
    participant Users as Affected Users
    participant Backend

    Monitor->>Monitor: Detect provider offline/fraud
    Monitor->>Police: Alert: Provider misbehavior

    alt Full Slash + Ban
        Police->>Contract: slashAndBan(provider)
        Contract->>Contract: Transfer full stake to treasury
        Contract->>Contract: Set isBanned = true
        Contract->>Contract: Increment slashCount
        Contract-->>Treasury: Receive slashed TLP
        Contract-->>Provider: ProviderSlashed event (banned=true)
    else Partial Slash
        Police->>Contract: slashPartial(provider, slashAmount)
        Contract->>Contract: Transfer slashAmount to treasury
        Contract->>Contract: Reduce stakeAmount
        Contract->>Contract: Increment slashCount
        Contract-->>Treasury: Receive slashed TLP
        Contract-->>Provider: ProviderSlashed event (banned=false)
    end

    Note over Backend,Users: Affected users can claim refunds
    Backend->>Backend: Sign refund approvals for affected rentals
    Users->>Contract: claimRefund(rentalId, amount, signatures)
    Contract-->>Users: Refund transferred
```

## 6. Provider Stake Management

Options for providers to manage their stake over time.

```mermaid
flowchart TD
    subgraph extend["Extend Stake Duration"]
        E1[Provider wants to accept longer rentals]
        E2[Call extendStakeDuration]
        E3{newUnlockTime > current<br/>AND >= now + minDuration?}
        E4[Update unlockTime]
        E5[StakeExtended event]
        E6[Reject: Invalid duration]

        E1 --> E2 --> E3
        E3 -->|Yes| E4 --> E5
        E3 -->|No| E6
    end

    subgraph increase["Increase Stake Amount"]
        I1[Provider wants more capacity/trust]
        I2[Approve additional TLP]
        I3[Call increaseStake]
        I4[Transfer TLP to contract]
        I5{Current unlockTime < now + minDuration?}
        I6[Extend unlockTime to now + minDuration]
        I7[Keep existing unlockTime]
        I8[StakeIncreased event]

        I1 --> I2 --> I3 --> I4 --> I5
        I5 -->|Yes| I6 --> I8
        I5 -->|No| I7 --> I8
    end

    subgraph withdraw["Withdraw Stake"]
        W1[Provider wants to exit]
        W2{block.timestamp >= unlockTime?}
        W3[Call withdrawStake]
        W4[Transfer all TLP back]
        W5[Remove from providers]
        W6[StakeWithdrawn event]
        W7[Wait until unlock time]

        W1 --> W2
        W2 -->|Yes| W3 --> W4 --> W5 --> W6
        W2 -->|No| W7
    end
```

## 7. Complete Rental Lifecycle

State machine showing all possible paths a rental can take.

```mermaid
stateDiagram-v2
    [*] --> ProviderStaked: Provider stakes TLP

    ProviderStaked --> RentalRequested: User requests VM

    RentalRequested --> BackendApproval: CLI finds provider
    BackendApproval --> SignaturesGenerated: Backend validates & signs

    SignaturesGenerated --> PaymentPending: User receives signatures
    PaymentPending --> RentalActive: User pays & submits tx

    RentalActive --> ServiceDelivery: Provider provisions VM

    ServiceDelivery --> FullCompletion: Service completed
    ServiceDelivery --> PartialCompletion: Partial service
    ServiceDelivery --> ServiceFailure: Provider failure

    FullCompletion --> ProviderWithdrawal: Provider claims full amount

    PartialCompletion --> SplitSettlement: Backend calculates split
    SplitSettlement --> ProviderWithdrawal: Provider claims earned portion
    SplitSettlement --> UserRefund: User claims refund portion

    ServiceFailure --> Slashing: Police slashes provider
    Slashing --> UserRefund: User claims full refund

    ProviderWithdrawal --> [*]: Rental closed
    UserRefund --> [*]: Rental closed
```

## 8. EIP712 Signature Flow

How signatures are created by the backend and verified on-chain.

```mermaid
flowchart LR
    subgraph domain["Domain Separator"]
        D1["name: TLPStaking"]
        D2["version: 1"]
        D3["chainId: network"]
        D4["verifyingContract: address"]
    end

    subgraph types["Message Types"]
        T1["RentalApproval<br/>(rentalId, user, provider, vm, duration, nonce)"]
        T2["WithdrawalApproval<br/>(rentalId, provider, amount, nonce)"]
        T3["RefundApproval<br/>(rentalId, user, amount, nonce)"]
    end

    subgraph signing["Signing Process"]
        S1[Backend creates typed data]
        S2[Hash with domain separator]
        S3[Sign with k signers]
        S4[Return signatures array]
    end

    subgraph verification["On-Chain Verification"]
        V1[Recreate digest from params]
        V2[Recover signer from each sig]
        V3[Check signer is authorized]
        V4[Check no duplicate signers]
        V5{k valid signatures?}
        V6[Accept operation]
        V7[Reject operation]
    end

    domain --> S1
    types --> S1
    S1 --> S2 --> S3 --> S4

    S4 --> V1 --> V2 --> V3 --> V4 --> V5
    V5 -->|Yes| V6
    V5 -->|No| V7
```

## 9. Fund Flow Overview

Visual representation of how TLP tokens move through the system.

```mermaid
flowchart TB
    subgraph users["Users"]
        U1[User 1]
        U2[User 2]
        U3[User N]
    end

    subgraph contract["TLPStaking Contract"]
        subgraph stakes["Provider Stakes"]
            PS1[Provider A: 10,000 TLP]
            PS2[Provider B: 5,000 TLP]
        end

        subgraph rentals["Rental Escrow"]
            R1["Rental 1: 3.6 TLP<br/>(withdrawn: 0, refunded: 0)"]
            R2["Rental 2: 7.2 TLP<br/>(withdrawn: 5, refunded: 0)"]
            R3["Rental 3: 10 TLP<br/>(withdrawn: 3, refunded: 4)"]
        end
    end

    subgraph providers["Providers"]
        P1[Provider A]
        P2[Provider B]
    end

    Treasury[(Treasury)]

    U1 -->|"rentFromProvider()"| R1
    U2 -->|"rentFromProvider()"| R2
    U3 -->|"rentFromProvider()"| R3

    P1 -->|"stake()"| PS1
    P2 -->|"stake()"| PS2

    R2 -->|"withdrawRental()"| P1
    R3 -->|"claimRefund()"| U3

    PS1 -->|"slashAndBan()"| Treasury
    PS2 -->|"withdrawStake()"| P2
```

## Key Concepts

### Nonce Strategy

| Action | Nonce Type | Tracking | Purpose |
|--------|-----------|----------|---------|
| Rental | Per-user | `rentalNonces[user]` | Prevent replay of same user's rental request |
| Withdrawal | Per-rental | `withdrawalNonces[rentalId]` | Allow multiple partial withdrawals |
| Refund | Per-rental | `refundNonces[rentalId]` | Allow multiple partial refunds |

### Available Balance Calculation

For any rental:
```
available = rental.amount - rental.withdrawnAmount - rental.refundedAmount
```

### Rental Duration Constraint

Before accepting a rental, the contract verifies:
```
block.timestamp + duration + rentalGracePeriod <= provider.unlockTime
```

This ensures the provider's stake remains locked for the entire rental period plus a 7-day grace period.
