import { ethers } from "hardhat";
import * as inquirer from "inquirer";
import chalk from "chalk";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TLPStaking, Timeleap } from "../typechain-types";

// ============ Constants ============
const VM_SMALL = ethers.encodeBytes32String("vm.small");
const VM_MEDIUM = ethers.encodeBytes32String("vm.medium");
const VM_LARGE = ethers.encodeBytes32String("vm.large");

const PRICE_SMALL = ethers.parseEther("0.001"); // per second
const PRICE_MEDIUM = ethers.parseEther("0.005");
const PRICE_LARGE = ethers.parseEther("0.01");

const DEFAULT_STAKE_AMOUNT = ethers.parseEther("10000");
const DEFAULT_STAKE_DURATION = 30 * 24 * 60 * 60; // 30 days

const POLICE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("POLICE_ROLE"));

// ============ State ============
let tlpToken: Timeleap;
let staking: TLPStaking;
let accounts: HardhatEthersSigner[];
let admin: HardhatEthersSigner;
let treasury: HardhatEthersSigner;
let police: HardhatEthersSigner;
let signers: HardhatEthersSigner[];

// ============ Helpers ============
function clearScreen() {
  process.stdout.write("\x1B[2J\x1B[0f");
}

function printHeader() {
  console.log(chalk.cyan("══════════════════════════════════════════════════════════════"));
  console.log(chalk.cyan.bold("  TLPStaking Local Testnet"));
  console.log(chalk.cyan("══════════════════════════════════════════════════════════════"));
  console.log();
  console.log(chalk.white("  Contracts:"));
  console.log(chalk.gray("    TLP Token:  ") + chalk.yellow(tlpToken.target));
  console.log(chalk.gray("    TLPStaking: ") + chalk.yellow(staking.target));
  console.log();
  console.log(chalk.white("  Network:"));
  console.log(chalk.gray("    Chain ID:   ") + chalk.yellow("31337"));
  console.log(chalk.gray("    RPC:        ") + chalk.yellow("http://127.0.0.1:8545"));
  console.log();
  console.log(chalk.white("  Admin:"));
  console.log(chalk.gray("    Address:    ") + chalk.yellow(admin.address));
  console.log(chalk.cyan("══════════════════════════════════════════════════════════════"));
  console.log();
}

function printSuccess(message: string) {
  console.log(chalk.green("✓ ") + message);
}

function printError(message: string) {
  console.log(chalk.red("✗ ") + message);
}

function printInfo(message: string) {
  console.log(chalk.blue("ℹ ") + message);
}

async function pressEnterToContinue() {
  await inquirer.prompt([
    {
      type: "input",
      name: "continue",
      message: "Press Enter to continue...",
    },
  ]);
}

// ============ Deploy & Setup ============
async function deployContracts() {
  console.log(chalk.cyan("\nDeploying contracts...\n"));

  accounts = await ethers.getSigners();
  admin = accounts[0];
  treasury = accounts[1];
  police = accounts[2];
  signers = [accounts[3], accounts[4], accounts[5]];

  // Deploy TLP token
  const TimeleapFactory = await ethers.getContractFactory("Timeleap");
  tlpToken = await TimeleapFactory.deploy(admin.address);
  await tlpToken.waitForDeployment();
  printSuccess(`TLP Token deployed at ${tlpToken.target}`);

  // Deploy staking contract
  const StakingFactory = await ethers.getContractFactory("TLPStaking");
  staking = await StakingFactory.deploy(
    await tlpToken.getAddress(),
    treasury.address,
    admin.address
  );
  await staking.waitForDeployment();
  printSuccess(`TLPStaking deployed at ${staking.target}`);

  // Setup roles
  await staking.connect(admin).grantRole(POLICE_ROLE, police.address);
  printSuccess(`Police role granted to ${police.address}`);

  // Add signers
  for (const signer of signers) {
    await staking.connect(admin).addSigner(signer.address);
  }
  printSuccess(`Added ${signers.length} signers`);

  // Set required signatures
  await staking.connect(admin).setRequiredRentalSignatures(2);
  await staking.connect(admin).setRequiredWithdrawalSignatures(2);
  await staking.connect(admin).setRequiredRefundSignatures(2);
  printSuccess("Required signatures set to 2-of-3");

  // Set VM prices
  await staking.connect(admin).setVmPrice(VM_SMALL, PRICE_SMALL);
  await staking.connect(admin).setVmPrice(VM_MEDIUM, PRICE_MEDIUM);
  await staking.connect(admin).setVmPrice(VM_LARGE, PRICE_LARGE);
  printSuccess("VM prices configured");

  console.log();
}

// ============ Menu Actions ============
async function fundWalletWithTLP() {
  const { address, amount } = await inquirer.prompt([
    {
      type: "input",
      name: "address",
      message: "Enter wallet address to fund:",
      validate: (input) => {
        if (ethers.isAddress(input)) return true;
        return "Please enter a valid Ethereum address";
      },
    },
    {
      type: "input",
      name: "amount",
      message: "Enter amount of TLP to send:",
      default: "10000",
      validate: (input) => {
        const num = parseFloat(input);
        if (!isNaN(num) && num > 0) return true;
        return "Please enter a valid positive number";
      },
    },
  ]);

  try {
    const amountWei = ethers.parseEther(amount);
    const tx = await tlpToken.connect(admin).transfer(address, amountWei);
    await tx.wait();
    printSuccess(`Sent ${amount} TLP to ${address}`);

    const balance = await tlpToken.balanceOf(address);
    printInfo(`New balance: ${ethers.formatEther(balance)} TLP`);
  } catch (error: any) {
    printError(`Failed to send TLP: ${error.message}`);
  }

  await pressEnterToContinue();
}

async function fundWalletWithETH() {
  const { address, amount } = await inquirer.prompt([
    {
      type: "input",
      name: "address",
      message: "Enter wallet address to fund:",
      validate: (input) => {
        if (ethers.isAddress(input)) return true;
        return "Please enter a valid Ethereum address";
      },
    },
    {
      type: "input",
      name: "amount",
      message: "Enter amount of ETH to send:",
      default: "10",
      validate: (input) => {
        const num = parseFloat(input);
        if (!isNaN(num) && num > 0) return true;
        return "Please enter a valid positive number";
      },
    },
  ]);

  try {
    const amountWei = ethers.parseEther(amount);
    const tx = await admin.sendTransaction({
      to: address,
      value: amountWei,
    });
    await tx.wait();
    printSuccess(`Sent ${amount} ETH to ${address}`);

    const balance = await ethers.provider.getBalance(address);
    printInfo(`New balance: ${ethers.formatEther(balance)} ETH`);
  } catch (error: any) {
    printError(`Failed to send ETH: ${error.message}`);
  }

  await pressEnterToContinue();
}

async function registerProvider() {
  const { address, amount, duration } = await inquirer.prompt([
    {
      type: "input",
      name: "address",
      message: "Enter provider wallet address:",
      validate: (input) => {
        if (ethers.isAddress(input)) return true;
        return "Please enter a valid Ethereum address";
      },
    },
    {
      type: "input",
      name: "amount",
      message: "Enter stake amount (TLP):",
      default: "10000",
      validate: (input) => {
        const num = parseFloat(input);
        if (!isNaN(num) && num > 0) return true;
        return "Please enter a valid positive number";
      },
    },
    {
      type: "input",
      name: "duration",
      message: "Enter stake duration (days):",
      default: "30",
      validate: (input) => {
        const num = parseInt(input);
        if (!isNaN(num) && num >= 30) return true;
        return "Duration must be at least 30 days";
      },
    },
  ]);

  try {
    const amountWei = ethers.parseEther(amount);
    const durationSeconds = parseInt(duration) * 24 * 60 * 60;

    // First fund the provider with TLP if needed
    const providerBalance = await tlpToken.balanceOf(address);
    if (providerBalance < amountWei) {
      const needed = amountWei - providerBalance;
      await tlpToken.connect(admin).transfer(address, needed);
      printInfo(`Funded provider with ${ethers.formatEther(needed)} TLP`);
    }

    // Find the signer for this address from hardhat accounts
    const providerSigner = accounts.find(a => a.address.toLowerCase() === address.toLowerCase());

    if (providerSigner) {
      // Approve and stake
      await tlpToken.connect(providerSigner).approve(staking.target, amountWei);
      await staking.connect(providerSigner).stake(amountWei, durationSeconds);
      printSuccess(`Registered provider ${address} with ${amount} TLP stake for ${duration} days`);
    } else {
      printError("Cannot stake: Address is not a known Hardhat account");
      printInfo("The provider must call stake() themselves after receiving TLP");
      printInfo(`Provider has been funded with ${amount} TLP`);
    }

    const info = await staking.getProviderInfo(address);
    if (info.stakeAmount > 0) {
      printInfo(`Provider stake: ${ethers.formatEther(info.stakeAmount)} TLP`);
    }
  } catch (error: any) {
    printError(`Failed to register provider: ${error.message}`);
  }

  await pressEnterToContinue();
}

async function showSigners() {
  console.log(chalk.cyan("\n  Authorized Signers (for EIP712 signatures):\n"));

  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    console.log(chalk.white(`  Signer ${i + 1}:`));
    console.log(chalk.gray("    Address:     ") + chalk.yellow(signer.address));
    // Get private key from hardhat's default accounts
    const privateKey = getHardhatPrivateKey(3 + i);
    console.log(chalk.gray("    Private Key: ") + chalk.yellow(privateKey));
    console.log();
  }

  const reqRental = await staking.requiredRentalSignatures();
  const reqWithdraw = await staking.requiredWithdrawalSignatures();
  const reqRefund = await staking.requiredRefundSignatures();

  console.log(chalk.white("  Required Signatures:"));
  console.log(chalk.gray("    Rentals:     ") + chalk.yellow(reqRental.toString()));
  console.log(chalk.gray("    Withdrawals: ") + chalk.yellow(reqWithdraw.toString()));
  console.log(chalk.gray("    Refunds:     ") + chalk.yellow(reqRefund.toString()));

  await pressEnterToContinue();
}

async function showVmPrices() {
  console.log(chalk.cyan("\n  VM Prices (per second):\n"));

  const priceSmall = await staking.vmPricePerSecond(VM_SMALL);
  const priceMedium = await staking.vmPricePerSecond(VM_MEDIUM);
  const priceLarge = await staking.vmPricePerSecond(VM_LARGE);

  console.log(chalk.white("  vm.small:"));
  console.log(chalk.gray("    ID:    ") + chalk.yellow(VM_SMALL));
  console.log(chalk.gray("    Price: ") + chalk.yellow(ethers.formatEther(priceSmall) + " TLP/sec"));
  console.log(chalk.gray("    Hour:  ") + chalk.yellow(ethers.formatEther(priceSmall * 3600n) + " TLP"));
  console.log();

  console.log(chalk.white("  vm.medium:"));
  console.log(chalk.gray("    ID:    ") + chalk.yellow(VM_MEDIUM));
  console.log(chalk.gray("    Price: ") + chalk.yellow(ethers.formatEther(priceMedium) + " TLP/sec"));
  console.log(chalk.gray("    Hour:  ") + chalk.yellow(ethers.formatEther(priceMedium * 3600n) + " TLP"));
  console.log();

  console.log(chalk.white("  vm.large:"));
  console.log(chalk.gray("    ID:    ") + chalk.yellow(VM_LARGE));
  console.log(chalk.gray("    Price: ") + chalk.yellow(ethers.formatEther(priceLarge) + " TLP/sec"));
  console.log(chalk.gray("    Hour:  ") + chalk.yellow(ethers.formatEther(priceLarge * 3600n) + " TLP"));

  await pressEnterToContinue();
}

async function showAccounts() {
  console.log(chalk.cyan("\n  Hardhat Accounts:\n"));

  const roles = [
    "Admin",
    "Treasury",
    "Police",
    "Signer 1",
    "Signer 2",
    "Signer 3",
    "Available",
    "Available",
    "Available",
    "Available",
  ];

  for (let i = 0; i < 10; i++) {
    const account = accounts[i];
    const ethBalance = await ethers.provider.getBalance(account.address);
    const tlpBalance = await tlpToken.balanceOf(account.address);
    const privateKey = getHardhatPrivateKey(i);

    console.log(chalk.white(`  [${i}] ${roles[i]}:`));
    console.log(chalk.gray("    Address:     ") + chalk.yellow(account.address));
    console.log(chalk.gray("    Private Key: ") + chalk.yellow(privateKey));
    console.log(chalk.gray("    ETH:         ") + chalk.green(ethers.formatEther(ethBalance)));
    console.log(chalk.gray("    TLP:         ") + chalk.green(ethers.formatEther(tlpBalance)));
    console.log();
  }

  await pressEnterToContinue();
}

async function checkProviderStatus() {
  const { address } = await inquirer.prompt([
    {
      type: "input",
      name: "address",
      message: "Enter provider address to check:",
      validate: (input) => {
        if (ethers.isAddress(input)) return true;
        return "Please enter a valid Ethereum address";
      },
    },
  ]);

  try {
    const info = await staking.getProviderInfo(address);
    const isActive = await staking.isProviderActive(address);

    console.log(chalk.cyan("\n  Provider Info:\n"));
    console.log(chalk.gray("    Address:     ") + chalk.yellow(address));
    console.log(chalk.gray("    Stake:       ") + chalk.yellow(ethers.formatEther(info.stakeAmount) + " TLP"));
    console.log(chalk.gray("    Unlock Time: ") + chalk.yellow(
      info.unlockTime > 0 ? new Date(Number(info.unlockTime) * 1000).toISOString() : "N/A"
    ));
    console.log(chalk.gray("    Banned:      ") + (info.isBanned ? chalk.red("Yes") : chalk.green("No")));
    console.log(chalk.gray("    Slash Count: ") + chalk.yellow(info.slashCount.toString()));
    console.log(chalk.gray("    Active:      ") + (isActive ? chalk.green("Yes") : chalk.red("No")));
  } catch (error: any) {
    printError(`Failed to get provider info: ${error.message}`);
  }

  await pressEnterToContinue();
}

async function addSigner() {
  const { address } = await inquirer.prompt([
    {
      type: "input",
      name: "address",
      message: "Enter address to add as signer:",
      validate: (input) => {
        if (ethers.isAddress(input)) return true;
        return "Please enter a valid Ethereum address";
      },
    },
  ]);

  try {
    // Check if already a signer
    const isAlreadySigner = await staking.isSigner(address);
    if (isAlreadySigner) {
      printError(`${address} is already a signer`);
      await pressEnterToContinue();
      return;
    }

    const tx = await staking.connect(admin).addSigner(address);
    await tx.wait();
    printSuccess(`Added ${address} as signer`);

    // Update local signers array if it's a hardhat account
    const signerAccount = accounts.find(a => a.address.toLowerCase() === address.toLowerCase());
    if (signerAccount && !signers.includes(signerAccount)) {
      signers.push(signerAccount);
    }

    const count = await staking.getSignerCount();
    printInfo(`Total signers: ${count}`);
  } catch (error: any) {
    printError(`Failed to add signer: ${error.message}`);
  }

  await pressEnterToContinue();
}

async function removeSigner() {
  // Get current signers
  const signerAddresses = await staking.getSigners();

  if (signerAddresses.length === 0) {
    printError("No signers to remove");
    await pressEnterToContinue();
    return;
  }

  const { address } = await inquirer.prompt([
    {
      type: "list",
      name: "address",
      message: "Select signer to remove:",
      choices: signerAddresses.map((addr: string) => ({
        name: addr,
        value: addr,
      })),
    },
  ]);

  try {
    const tx = await staking.connect(admin).removeSigner(address);
    await tx.wait();
    printSuccess(`Removed ${address} from signers`);

    // Update local signers array
    const index = signers.findIndex(s => s.address.toLowerCase() === address.toLowerCase());
    if (index > -1) {
      signers.splice(index, 1);
    }

    const count = await staking.getSignerCount();
    printInfo(`Remaining signers: ${count}`);

    // Show if required signatures were adjusted
    const reqRental = await staking.requiredRentalSignatures();
    const reqWithdraw = await staking.requiredWithdrawalSignatures();
    const reqRefund = await staking.requiredRefundSignatures();
    printInfo(`Required signatures - Rental: ${reqRental}, Withdrawal: ${reqWithdraw}, Refund: ${reqRefund}`);
  } catch (error: any) {
    printError(`Failed to remove signer: ${error.message}`);
  }

  await pressEnterToContinue();
}

async function setVmPrice() {
  const { vmChoice, customVm, price } = await inquirer.prompt([
    {
      type: "list",
      name: "vmChoice",
      message: "Select VM type:",
      choices: [
        { name: "vm.small", value: "vm.small" },
        { name: "vm.medium", value: "vm.medium" },
        { name: "vm.large", value: "vm.large" },
        { name: "Custom...", value: "custom" },
      ],
    },
    {
      type: "input",
      name: "customVm",
      message: "Enter custom VM name:",
      when: (answers) => answers.vmChoice === "custom",
      validate: (input) => {
        if (input.length > 0 && input.length <= 31) return true;
        return "VM name must be 1-31 characters";
      },
    },
    {
      type: "input",
      name: "price",
      message: "Enter price per second (TLP):",
      default: "0.001",
      validate: (input) => {
        const num = parseFloat(input);
        if (!isNaN(num) && num >= 0) return true;
        return "Please enter a valid non-negative number";
      },
    },
  ]);

  try {
    const vmName = vmChoice === "custom" ? customVm : vmChoice;
    const vmId = ethers.encodeBytes32String(vmName);
    const priceWei = ethers.parseEther(price);

    const tx = await staking.connect(admin).setVmPrice(vmId, priceWei);
    await tx.wait();

    if (parseFloat(price) === 0) {
      printSuccess(`Disabled VM type: ${vmName}`);
    } else {
      printSuccess(`Set price for ${vmName}: ${price} TLP/sec`);
      printInfo(`Hourly cost: ${parseFloat(price) * 3600} TLP`);
    }
  } catch (error: any) {
    printError(`Failed to set VM price: ${error.message}`);
  }

  await pressEnterToContinue();
}

async function setRequiredSignatures() {
  const signerCount = await staking.getSignerCount();

  const { rentalSigs, withdrawalSigs, refundSigs } = await inquirer.prompt([
    {
      type: "input",
      name: "rentalSigs",
      message: `Required signatures for rentals (1-${signerCount}):`,
      default: (await staking.requiredRentalSignatures()).toString(),
      validate: (input) => {
        const num = parseInt(input);
        if (!isNaN(num) && num >= 1 && num <= Number(signerCount)) return true;
        return `Please enter a number between 1 and ${signerCount}`;
      },
    },
    {
      type: "input",
      name: "withdrawalSigs",
      message: `Required signatures for withdrawals (1-${signerCount}):`,
      default: (await staking.requiredWithdrawalSignatures()).toString(),
      validate: (input) => {
        const num = parseInt(input);
        if (!isNaN(num) && num >= 1 && num <= Number(signerCount)) return true;
        return `Please enter a number between 1 and ${signerCount}`;
      },
    },
    {
      type: "input",
      name: "refundSigs",
      message: `Required signatures for refunds (1-${signerCount}):`,
      default: (await staking.requiredRefundSignatures()).toString(),
      validate: (input) => {
        const num = parseInt(input);
        if (!isNaN(num) && num >= 1 && num <= Number(signerCount)) return true;
        return `Please enter a number between 1 and ${signerCount}`;
      },
    },
  ]);

  try {
    await staking.connect(admin).setRequiredRentalSignatures(parseInt(rentalSigs));
    await staking.connect(admin).setRequiredWithdrawalSignatures(parseInt(withdrawalSigs));
    await staking.connect(admin).setRequiredRefundSignatures(parseInt(refundSigs));

    printSuccess(`Updated required signatures:`);
    printInfo(`  Rentals: ${rentalSigs}-of-${signerCount}`);
    printInfo(`  Withdrawals: ${withdrawalSigs}-of-${signerCount}`);
    printInfo(`  Refunds: ${refundSigs}-of-${signerCount}`);
  } catch (error: any) {
    printError(`Failed to set required signatures: ${error.message}`);
  }

  await pressEnterToContinue();
}

// Hardhat default private keys (deterministic from mnemonic)
function getHardhatPrivateKey(index: number): string {
  const keys = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
    "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
    "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
    "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
    "0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897",
    "0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82",
    "0xa267530f49f8280200edf313ee7af6b827f2a8bce2897751d06a843f644967b1",
    "0x47c99abed3324a2707c28affff1267e45918ec8c3f20b8aa892e8b065d2942dd",
    "0xc526ee95bf44d8fc405a158bb884d9d1238d99f0612e9f33d006bb0789009aaa",
    "0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61",
    "0xea6c44ac03bff858b476bba40716402b03e41b8e97e276d1baec7c37d42484a0",
    "0x689af8efa8c651a91ad287602527f3af2fe9f6501a7ac4b061667b5a93e037fd",
    "0xde9be858da4a475276426320d5e9262ecfc3ba460bfac56360bfa6c4c28b4ee0",
    "0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e",
  ];
  return keys[index] || "0x0000000000000000000000000000000000000000000000000000000000000000";
}

// ============ Main Menu ============
async function mainMenu() {
  while (true) {
    clearScreen();
    printHeader();

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "Fund wallet with TLP", value: "fundTLP" },
          { name: "Fund wallet with ETH", value: "fundETH" },
          { name: "Register provider (stake)", value: "registerProvider" },
          { name: "Check provider status", value: "checkProvider" },
          new inquirer.Separator() as any,
          { name: "Add signer", value: "addSigner" },
          { name: "Remove signer", value: "removeSigner" },
          { name: "Set required signatures", value: "setRequiredSigs" },
          new inquirer.Separator() as any,
          { name: "Set VM price", value: "setVmPrice" },
          { name: "Show VM prices", value: "showVmPrices" },
          new inquirer.Separator() as any,
          { name: "Show signers & keys", value: "showSigners" },
          { name: "Show all accounts", value: "showAccounts" },
          new inquirer.Separator() as any,
          { name: "Exit", value: "exit" },
        ],
      },
    ]);

    switch (action) {
      case "fundTLP":
        await fundWalletWithTLP();
        break;
      case "fundETH":
        await fundWalletWithETH();
        break;
      case "registerProvider":
        await registerProvider();
        break;
      case "checkProvider":
        await checkProviderStatus();
        break;
      case "addSigner":
        await addSigner();
        break;
      case "removeSigner":
        await removeSigner();
        break;
      case "setRequiredSigs":
        await setRequiredSignatures();
        break;
      case "setVmPrice":
        await setVmPrice();
        break;
      case "showSigners":
        await showSigners();
        break;
      case "showVmPrices":
        await showVmPrices();
        break;
      case "showAccounts":
        await showAccounts();
        break;
      case "exit":
        console.log(chalk.cyan("\nGoodbye!\n"));
        process.exit(0);
    }
  }
}

// ============ Entry Point ============
async function main() {
  clearScreen();
  console.log(chalk.cyan.bold("\n  TLPStaking Local Testnet Setup\n"));

  await deployContracts();

  console.log(chalk.green("\n  Setup complete! Starting interactive menu...\n"));
  await new Promise((resolve) => setTimeout(resolve, 1500));

  await mainMenu();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
