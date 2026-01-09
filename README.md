# TLPStaking

A Solidity smart contract for Timeleap's decentralized compute marketplace. Providers stake TLP tokens to offer VM resources, and users rent compute capacity with signature-based authorization.

## Overview

TLPStaking enables a trustless marketplace where:

- **Providers** stake TLP tokens as collateral to offer compute resources
- **Users** rent VM resources from providers with pre-authorized signatures
- **Police** can slash misbehaving providers to protect users
- **Backend signers** authorize all rentals, withdrawals, and refunds via k-of-n EIP712 signatures

## Features

- **Provider Staking**: Lock TLP tokens with minimum 30-day duration
- **VM Rentals**: Users rent compute resources with dynamic pricing per VM type
- **EIP712 Signatures**: k-of-n multisig authorization for all financial operations
- **Flexible Withdrawals**: Providers withdraw earnings with backend approval
- **Refund System**: Users claim refunds for unused resources
- **Slashing**: Police role can slash and ban malicious providers

## Quick Start

### Installation

```bash
npm install
```

### Compile

```bash
npx hardhat compile
```

### Test

```bash
npx hardhat test
```

### Deploy

```bash
npx hardhat ignition deploy ignition/modules/TLPStaking.ts --network <network>
```

### Local Testnet

For development and testing, run a local testnet with an interactive TUI:

```bash
# Terminal 1: Start local Hardhat node
npm run localnet

# Terminal 2: Deploy contracts and start interactive menu
npm run localnet:setup
```

The TUI provides:
- **Fund wallets** with TLP or ETH
- **Register providers** (stake TLP)
- **Manage signers** (add/remove, set required signatures)
- **Configure VM prices** (set pricing per second)
- **View accounts** with private keys for testing

Default setup:
- 3 authorized signers (2-of-3 required)
- VM prices: small (0.001), medium (0.005), large (0.01) TLP/sec
- Admin, Treasury, and Police roles assigned

## Contract Architecture

```
TLPStaking
├── Provider Functions
│   ├── stake(amount, duration)
│   ├── extendStakeDuration(newUnlockTime)
│   ├── increaseStake(amount)
│   └── withdrawStake()
├── User Functions
│   ├── rentFromProvider(provider, vm, duration, signatures)
│   └── claimRefund(rentalId, amount, signatures)
├── Provider Withdrawal
│   └── withdrawRental(rentalId, amount, signatures)
├── Police Functions
│   ├── slashAndBan(provider)
│   └── slashPartial(provider, amount)
└── Admin Functions
    ├── addSigner/removeSigner
    ├── setRequiredRentalSignatures
    ├── setRequiredWithdrawalSignatures
    ├── setRequiredRefundSignatures
    └── setVmPrice(vm, pricePerSecond)
```

## Signature Flow

All financial operations require k-of-n EIP712 signatures from authorized backend signers:

1. **Rentals**: Backend validates user request and signs approval
2. **Withdrawals**: Backend verifies service delivery and signs withdrawal
3. **Refunds**: Backend determines refund eligibility and signs refund

This enables off-chain validation while maintaining on-chain security.

## TypeScript Client

A full-featured client library is included:

```typescript
import { TLPStakingClient, TLPStakingSigner } from "./src/client";

// Create client
const client = new TLPStakingClient(provider, contractAddress);

// Read operations
const rental = await client.getRental(0n);
const isActive = await client.isProviderActive(providerAddress);

// Create signer for EIP712 signatures
const signer = await client.createSigner(wallet);
const signature = await signer.signRentalApproval({
  user: userAddress,
  provider: providerAddress,
  vm: vmId,
  duration: 3600n,
  nonce: 0n,
});
```

## Documentation

- [User Stories](./docs/USER_STORIES.md) - Detailed user flows
- [Architecture](./docs/ARCHITECTURE.md) - Technical design
- [API Reference](./docs/API.md) - Contract API documentation
- [Client Library](./docs/CLIENT_LIBRARY.md) - TypeScript SDK usage

## Security

- Built on OpenZeppelin contracts (AccessControl, ReentrancyGuard, EIP712)
- SafeERC20 for token transfers
- Nonce-based replay protection
- k-of-n signature verification

## License

MIT
