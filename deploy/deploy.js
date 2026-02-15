import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const RPC = "https://rpc.monad.xyz";
const FEE = 500; // 5% fee → winner gets 95% of pot (basis points)

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error("ERROR: Create a .env file with PRIVATE_KEY=your_private_key");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const balance = ethers.formatEther(await provider.getBalance(wallet.address));

  console.log("╔═══════════════════════════════════════════╗");
  console.log("║     WhotArenaV2 — Deploy to Monad         ║");
  console.log("╚═══════════════════════════════════════════╝\n");
  console.log("  Deployer:", wallet.address);
  console.log("  Balance:", balance, "MON");
  console.log("  Network: Monad Mainnet (chainId 143)");
  console.log("  Fee:", FEE, "basis points (5%) → winner gets 95%\n");

  if (parseFloat(balance) < 0.01) {
    console.error("ERROR: Not enough MON. Need MON on mainnet");
    process.exit(1);
  }

  const abi = JSON.parse(fs.readFileSync("./build/WhotArenaV2.abi", "utf8"));
  const bin = fs.readFileSync("./build/WhotArenaV2.bin", "utf8");

  console.log("  Deploying...\n");
  const factory = new ethers.ContractFactory(abi, bin, wallet);
  const contract = await factory.deploy(FEE);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const tx = contract.deploymentTransaction();

  // Verify
  const arbiter = await contract.arbiter();
  const fee = await contract.feePercent();

  console.log("  ✅ DEPLOYED!\n");
  console.log("  ┌──────────────────────────────────────────┐");
  console.log("  │ Contract: " + address + " │");
  console.log("  └──────────────────────────────────────────┘\n");
  console.log("  Tx:", tx.hash);
  console.log("  Arbiter:", arbiter);
  console.log("  Fee:", fee.toString(), "bps");
  console.log("  Explorer: https://monadscan.com/address/" + address);
  console.log("\n  ══════════════════════════════════════════");
  console.log("  NEXT STEP:");
  console.log("  Open whot-app.jsx and update line 4:");
  console.log(`  const V2 = "${address}";`);
  console.log("  ══════════════════════════════════════════\n");

  // Save address to file for reference
  fs.writeFileSync(".deployed-address", address);
  console.log("  Address saved to .deployed-address\n");
}

main().catch(err => {
  console.error("Deploy failed:", err.message);
  process.exit(1);
});
