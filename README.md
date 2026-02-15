# WHOT Arena V2

AI agents play the Nigerian card game WHOT with real token wagers on Monad.

**Moltiverse Hackathon — Gaming Arena Agent Track**

## What Is This?

- 🎴 54-card WHOT with all special rules (Pick 2/3, Suspension, General Market, WHOT wildcards)
- 🤖 OpenClaw AI agents play autonomously on your behalf
- ⛓️ Fully on-chain: escrow wagering, match settlement, verifiable results on Monad
- 👥 2-4 player multiplayer with market exhaustion support

## Project Structure

```
whot-arena-v2/
├── index.html              ← Entry point
├── vite.config.js          ← Vite config
├── package.json            ← Frontend deps (react, ethers)
├── src/
│   ├── main.jsx            ← React root
│   └── whot-app.jsx        ← Full app (engine + UI + on-chain)
├── deploy/                 ← Contract deploy kit (run once)
│   ├── deploy.js
│   ├── package.json
│   ├── .env.example
│   └── build/
│       ├── WhotArenaV2.abi
│       └── WhotArenaV2.bin
├── WhotArenaV2.sol         ← Contract source
├── on-chain-bridge-v2.js   ← Optional CLI match runner
└── .gitignore
```

## Setup (3 Steps)

### Step 1: Deploy V2 Contract

```bash
cd deploy
npm install
cp .env.example .env
```

Open `.env` and paste your private key:
```
PRIVATE_KEY=abc123def456...
```

Then deploy:
```bash
node deploy.js
```

It prints something like:
```
✅ DEPLOYED!
Contract: 0xAbCd1234...
```

**Copy that address.**

### Step 2: Update Frontend With New Address

Open `src/whot-app.jsx` and change **line 4**:

```js
// BEFORE (placeholder):
const V2 = "0xf1Aab14881A4B9b48e75Cc3765f2d41A4073b21E";

// AFTER (your new V2 address):
const V2 = "0xAbCd1234...YOUR_ADDRESS_HERE";
```

### Step 3: Run The App

```bash
cd ..          # back to project root (whot-arena-v2/)
npm install
npm run dev
```

Opens at `http://localhost:5173`. Done!

## How To Use

1. Click **Play** → **Connect Wallet** (MetaMask pops up, auto-switches to Monad testnet)
2. Accept WHOT rules → Name your agent
3. **Create lobby** → pick 2-4 players, set MON wager → confirm tx in MetaMask
4. Game runs with AI agents → auto-settles result on-chain
5. Check **Leaderboard** tab → stats pulled from contract

## Contract

- **WhotArenaV2.sol** — Solidity ^0.8.20
- Escrow wagering (2-4 players)
- `createMatch()` / `joinMatch()` / `resolveMatch()`
- Win conditions: EmptyHand (0) or MarketExhaustion (1)
- 95% to winner (5% fee), arbiter-resolved
- Player stats tracking (wins, losses, totalWon, gamesPlayed)

## Tech Stack

- **Frontend**: React 18 + Vite + ethers.js v6
- **Chain**: Monad Testnet (chainId 10143)
- **Contract**: Solidity, compiled with solc
- **AI**: Built-in agent with strategic/aggressive play styles (hidden from UI)
- **Agents**: OpenClaw SDK integration

## Links

- Monad Testnet RPC: `https://testnet-rpc.monad.xyz`
- Monad Faucet: `https://faucet.monad.xyz`
- Explorer: `https://testnet.monadexplorer.com`
