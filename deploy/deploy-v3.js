import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const RPC = "https://rpc.monad.xyz";
const FEE = 500; // 5% fee in basis points

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error("ERROR: Create a .env file with PRIVATE_KEY=your_private_key");
    process.exit(1);
  }
  if (!process.env.WHOT_TOKEN) {
    console.error("ERROR: Add WHOT_TOKEN=0x... to your .env (the $WHOT token address from nad.fun)");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const balance = ethers.formatEther(await provider.getBalance(wallet.address));

  console.log("╔═══════════════════════════════════════════╗");
  console.log("║     WhotArenaV3 — Deploy to Monad         ║");
  console.log("║     ERC-20 $WHOT Token Wagers             ║");
  console.log("╚═══════════════════════════════════════════╝\n");
  console.log("  Deployer:", wallet.address);
  console.log("  Balance:", balance, "MON");
  console.log("  Network: Monad Mainnet (chainId 143)");
  console.log("  $WHOT Token:", process.env.WHOT_TOKEN);
  console.log("  Fee:", FEE, "basis points (5%) → winner gets 95%\n");

  if (parseFloat(balance) < 0.01) {
    console.error("ERROR: Not enough MON for gas.");
    process.exit(1);
  }

  const abi = JSON.parse(fs.readFileSync("./build/WhotArenaV3.abi", "utf8"));
  const bin = fs.readFileSync("./build/WhotArenaV3.bin", "utf8");

  console.log("  Deploying...\n");
  const factory = new ethers.ContractFactory(abi, bin, wallet);
  const contract = await factory.deploy(process.env.WHOT_TOKEN, FEE);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const tx = contract.deploymentTransaction();

  const arbiter = await contract.arbiter();
  const fee = await contract.feePercent();
  const token = await contract.whotToken();

  console.log("  ✅ DEPLOYED!\n");
  console.log("  ┌──────────────────────────────────────────┐");
  console.log("  │ Contract: " + address + " │");
  console.log("  └──────────────────────────────────────────┘\n");
  console.log("  Tx:", tx.hash);
  console.log("  Arbiter:", arbiter);
  console.log("  Fee:", fee.toString(), "bps");
  console.log("  $WHOT Token:", token);
  console.log("  Explorer: https://monadscan.com/address/" + address);
  console.log("\n  ══════════════════════════════════════════");
  console.log("  NEXT STEP:");
  console.log("  Open whot-app.jsx and update line 4:");
  console.log(`  const V2 = "${address}";`);
  console.log("  And update the WHOT_TOKEN address on line 5:");
  console.log(`  const WHOT_TOKEN = "${process.env.WHOT_TOKEN}";`);
  console.log("  ══════════════════════════════════════════\n");

  fs.writeFileSync(".deployed-address-v3", address);
  console.log("  Address saved to .deployed-address-v3\n");
}

main().catch(err => {
  console.error("Deploy failed:", err.message);
  process.exit(1);
});
