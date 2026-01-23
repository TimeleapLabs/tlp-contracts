# TLPStaking Interaction Flowcharts

This document contains Mermaid flowcharts illustrating the various user, provider, and system interactions with the TLPStaking smart contracts.

## 1. User Deposits to Pool

Users deposit TLP tokens into the pool without requiring any signatures.

```mermaid
sequenceDiagram
    participant User
    participant CLI as Timeleap CLI
    participant Contract as TLPStaking Contract

    User->>CLI: Request to deposit TLP
    CLI->>User: Show deposit interface

    User->>Contract: approve(stakingContract, amount)
    User->>Contract: deposit(amount)

    Contract->>Contract: Verify amount > 0
    Contract->>Contract: Transfer TLP from user
    Contract->>Contract: Update userBalances[user]
    Contract-->>User: Deposited event

    CLI-->>User: Deposit confirmed<br/>Balance updated
```

## 2. User Withdraws from Pool

Users withdraw their balance with backend-signed approval.

```mermaid
sequenceDiagram
    participant User
    participant CLI as Timeleap CLI
    participant Backend as Timeleap Backend
    participant Contract as TLPStaking Contract

    User->>CLI: Request to withdraw tokens
    CLI->>Backend: Request withdrawal approval

    Backend->>Contract: Query nonces[user]
    Contract-->>Backend: Current nonce

    Backend->>Backend: Create EIP712 Withdrawal<br/>{user, amount, nonce, deadline}
    Backend->>Backend: Sign with k-of-n signers
    Backend-->>CLI: Return signatures + deadline

    CLI-->>User: Show withdrawal details
    User->>Contract: withdraw(amount, deadline, signatures)

    Contract->>Contract: Verify deadline not expired
    Contract->>Contract: Verify k-of-n signatures
    Contract->>Contract: Check amount <= userBalances[user]
    Contract->>Contract: Update balance and nonce
    Contract->>Contract: Transfer TLP to user
    Contract-->>User: Withdrawn event

    CLI-->>User: Withdrawal confirmed
```

## 3. Provider Registration (Staking)

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
    Contract->>Contract: Create ProviderInfo<br/>{stakeAmount, unlockTime, isBanned=false, slashCount=0}
    Contract-->>Provider: Staked event

    CLI->>Marketplace: Register provider in marketplace
    Marketplace-->>Provider: Provider now active<br/>Can receive service requests
```

## 4. Provider Claims Earnings

Provider claims from a user's balance after delivering service. A commission is deducted and sent to the treasury.

```mermaid
sequenceDiagram
    participant Provider
    participant CLI as Timeleap CLI
    participant Backend as Timeleap Backend
    participant Contract as TLPStaking Contract
    participant Treasury

    Provider->>CLI: Request claim for service
    CLI->>Backend: Verify service delivery

    Backend->>Backend: Check service metrics
    Backend->>Backend: Calculate claim amount
    Backend->>Contract: Query nonces[provider]
    Contract-->>Backend: Current nonce

    Backend->>Backend: Create EIP712 Claim<br/>{rentalId, user, provider, amount, nonce, deadline}
    Backend->>Backend: Sign with k-of-n signers
    Backend-->>CLI: Return signatures + deadline

    Provider->>Contract: claim(rentalId, user, amount, deadline, signatures)

    Contract->>Contract: Verify provider is active & not banned
    Contract->>Contract: Verify signatures
    Contract->>Contract: Check amount <= userBalances[user]
    Contract->>Contract: Calculate commission<br/>(amount × commissionBps / 10000)
    Contract->>Contract: Update user balance and provider nonce
    Contract->>Treasury: Transfer commission
    Contract->>Provider: Transfer (amount - commission)
    Contract-->>Provider: Claimed event (includes rentalId for audit)
```

## 5. Provider Batch Claims

Provider claims from multiple users in a single transaction for gas efficiency.

```mermaid
sequenceDiagram
    participant Provider
    participant Backend as Timeleap Backend
    participant Contract as TLPStaking Contract
    participant Treasury

    Provider->>Backend: Request batch claims<br/>(multiple users/rentals)

    Backend->>Contract: Query nonces[provider]
    Contract-->>Backend: Current nonce

    loop For each claim
        Backend->>Backend: Create EIP712 Claim<br/>{rentalId_i, user_i, provider, amount_i, nonce+i, deadline}
        Backend->>Backend: Sign with k-of-n signers
    end

    Backend-->>Provider: Return all signatures

    Provider->>Contract: batchClaim(claims[], signatures[][])

    Contract->>Contract: Verify provider active & not banned
    loop For each claim
        Contract->>Contract: Verify signatures
        Contract->>Contract: Update user balance
        Contract->>Contract: Increment nonce
        Contract->>Contract: Calculate commission
    end
    Contract->>Treasury: Transfer total commission
    Contract->>Provider: Transfer total (amount - commission)
    loop For each claim
        Contract-->>Provider: Emit Claimed event
    end
```

## 6. Provider Misbehavior & Slashing

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

    Note over Backend,Users: Users still have their pool balance<br/>Backend can assign them to new providers
```

## 7. Provider Stake Management

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

## 8. Provider Migration Scenario

How the system handles seamless provider migration when a provider goes down.

```mermaid
sequenceDiagram
    participant User
    participant Backend
    participant ProviderA as Provider A
    participant ProviderB as Provider B
    participant Contract

    User->>Contract: deposit(100 TLP)
    Contract-->>User: Deposited event

    Note over Backend: Backend assigns user to Provider A

    ProviderA->>User: Provision VM service
    Note over ProviderA: Provider A serves user...

    ProviderA--xBackend: Provider A goes down!

    Backend->>Backend: Detect downtime
    Backend->>Backend: Calculate Provider A's earned amount (30 TLP)

    Note over Backend: Backend migrates user to Provider B

    ProviderB->>User: Continue VM service

    Note over Backend: Time passes, service continues...

    Backend->>Backend: Provider A claims for service delivered
    ProviderA->>Contract: claim(rentalId1, user, 30 TLP, ...)
    Contract->>ProviderA: Transfer 30 TLP (minus commission)
    Contract-->>Contract: User balance: 70 TLP

    Backend->>Backend: Provider B claims for continued service
    ProviderB->>Contract: claim(rentalId2, user, 40 TLP, ...)
    Contract->>ProviderB: Transfer 40 TLP (minus commission)
    Contract-->>Contract: User balance: 30 TLP

    User->>Backend: Request withdrawal of remaining balance
    Backend->>Contract: Sign withdrawal for 30 TLP
    User->>Contract: withdraw(30 TLP, deadline, signatures)
    Contract->>User: Transfer 30 TLP
    Contract-->>Contract: User balance: 0 TLP
```

## 9. EIP712 Signature Flow

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
        T1["Withdrawal<br/>(user, amount, nonce, deadline)"]
        T2["Claim<br/>(rentalId, user, provider, amount, nonce, deadline)"]
    end

    subgraph signing["Signing Process"]
        S1[Backend creates typed data]
        S2[Hash with domain separator]
        S3[Sign with k signers]
        S4[Return signatures array]
    end

    subgraph verification["On-Chain Verification"]
        V1[Check deadline not expired]
        V2[Recreate digest from params]
        V3[Recover signer from each sig]
        V4[Check signer is authorized]
        V5[Check no duplicate signers]
        V6{k valid signatures?}
        V7[Accept operation]
        V8[Reject operation]
    end

    domain --> S1
    types --> S1
    S1 --> S2 --> S3 --> S4

    S4 --> V1 --> V2 --> V3 --> V4 --> V5 --> V6
    V6 -->|Yes| V7
    V6 -->|No| V8
```

## 10. Token Flow Overview

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

        subgraph pool["User Balance Pool"]
            UB1["User 1: 100 TLP"]
            UB2["User 2: 50 TLP"]
            UB3["User 3: 200 TLP"]
        end
    end

    subgraph providers["Providers"]
        P1[Provider A]
        P2[Provider B]
    end

    Treasury[(Treasury)]

    U1 -->|"deposit()"| UB1
    U2 -->|"deposit()"| UB2
    U3 -->|"deposit()"| UB3

    P1 -->|"stake()"| PS1
    P2 -->|"stake()"| PS2

    UB1 -->|"claim()<br/>(minus commission)"| P1
    UB1 -->|"withdraw()<br/>(with signatures)"| U1
    UB2 -->|"claim()<br/>(minus commission)"| P2

    pool -->|"commission"| Treasury

    PS1 -->|"slashAndBan()"| Treasury
    PS2 -->|"withdrawStake()"| P2
```

## Key Concepts

### Nonce Strategy

| Action     | Nonce Type   | Tracking           | Purpose                               |
| ---------- | ------------ | ------------------ | ------------------------------------- |
| Withdrawal | Per-user     | `nonces[user]`     | Prevent replay of withdrawal requests |
| Claim      | Per-provider | `nonces[provider]` | Prevent replay of claim requests      |

### Signature Deadline

All signatures include a `deadline` parameter:

```
if (block.timestamp > deadline) revert SignatureExpired();
```

This provides time-based protection in addition to nonce-based replay prevention.

### Commission on Claims

When providers claim earnings, a commission is deducted and sent to the treasury:

```
commission = amount × commissionBps / 10000
providerReceives = amount - commission
```

Commission is configured in basis points (e.g., 500 = 5%, 1000 = 10%). Maximum is 10000 (100%).

### Provider Migration

The pool-based architecture enables seamless provider migration:

1. **User deposits once** - tokens stay in the pool
2. **Backend manages assignments** - no on-chain rental state
3. **Multiple providers can claim** - from the same user's balance
4. **No retoken logic needed** - unused balance remains in pool
