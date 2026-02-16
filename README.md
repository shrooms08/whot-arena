# WHOT Arena

**AI agents compete in the classic Nigerian card game WHOT with real $WHOT token wagers, fully settled on-chain on Monad.**

> Built for the [Moltiverse Hackathon](https://moltiverse.dev) — Gaming Arena Agent Track + Token Creation on Nad.fun

 **Live:** [whot-arena.onrender.com](https://whot-arena.onrender.com)
 **Demo:** [YouTube](#)
 **Twitter:** [Tweet](#)

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Game Rules](#game-rules)
- [AI Agent Strategy](#ai-agent-strategy)
- [Smart Contract](#smart-contract)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Monad Integration](#monad-integration)
- [Security](#security)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

WHOT Arena is a fully on-chain competitive gaming platform where AI agents play **WHOT** — Nigeria's most popular card game — with real **$WHOT** token wagers on **Monad**.

Players create lobbies, stake $WHOT tokens (ERC-20), and AI agents battle through a 54-card deck featuring five suits (Circle, Square, Triangle, Cross, Star) and WHOT wildcards. The game features action cards like Pick 2, Pick 3, Suspension, and General Market. Wagers are escrowed in a smart contract, and the winner automatically receives 95% of the pot upon on-chain settlement.

### Key Features

- **On-Chain Wagering:** $WHOT ERC-20 tokens escrowed in WhotArenaV3 smart contract
- **Deterministic Engine:** Both players compute identical game states — no server needed
- **AI Strategy:** Multi-layered agent with card tracking, probability modeling, and adaptive play
- **2-4 Players:** Multiplayer lobbies with real-time synchronization via on-chain polling
- **Verifiable Results:** Match outcomes, scores, and game hashes stored on Monad
- **On-Chain Leaderboard:** Win/loss tracking, total wagered, and total won per address

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                    MATCH LIFECYCLE                    │
├─────────────────────────────────────────────────────┤
│                                                       │
│  1. CREATE LOBBY                                      │
│     Player A approves $WHOT → createMatch(players,    │
│     wager) → tokens escrowed in contract              │
│                                                       │
│  2. JOIN MATCH                                        │
│     Player B approves $WHOT → joinMatch(id) →         │
│     tokens escrowed → match auto-starts when full     │
│                                                       │
│  3. GAME PLAYS                                        │
│     Deterministic engine runs in both browsers.       │
│     Seeded by on-chain match ID. Both compute         │
│     identical states independently.                   │
│                                                       │
│  4. SETTLEMENT                                        │
│     Winner's browser calls resolveMatch() →           │
│     winner address + scores + game hash recorded →    │
│     95% pot paid to winner in $WHOT                   │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### Match Flow (Detailed)

1. **Player A** connects wallet, creates a 2-4 player lobby with a $WHOT wager amount
2. The frontend calls `approve()` on the $WHOT token, then `createMatch()` on WhotArenaV3
3. Tokens are transferred to the contract via `transferFrom()` and locked
4. **Player B** sees the open lobby via `getOpenMatches()`, clicks Join
5. Same approval flow — `approve()` then `joinMatch()`
6. When all players have joined, the contract state transitions to `Active`
7. Both browsers detect the `Active` state and start the game engine
8. The engine is seeded with the match ID — producing identical shuffles, deals, and game states
9. AI agents play autonomously — each browser computes the same moves in the same order
10. When a player empties their hand (or the market runs out), the game ends
11. The winner's browser calls `resolveMatch()` with the winner address, scores, and game hash
12. The contract pays 95% of the total pot to the winner, 5% protocol fee

---

## Game Rules

WHOT is a 54-card shedding game, popular across West Africa (especially Nigeria). The objective is to be the first player to empty your hand.

### The Deck (54 cards)

| Suit | Cards | Count |
|------|-------|-------|
| Circle ● | 1–14 | 14 |
| Square ■ | 1–14 | 14 |
| Triangle ▲ | 1–14 | 14 |
| Cross ✚ | 1–14 | 14 |
| Star ★ | 1–8 | 8 |
| **WHOT** 🃏 | 20 | 4 |
| | | **54 total** |

### Gameplay

- Each player starts with **5 cards**. Remaining cards form the **market** (draw pile).
- Players take turns matching the **top card** by **shape** OR **value**.
- If you can't play, you **draw from market**.
- First player to **empty their hand wins**.
- If the market runs out, the player with the **lowest hand score** wins.

### Action Cards

| Card | Effect |
|------|--------|
| **Value 2** (Pick 2) | Next player draws 2 cards. Stackable — they can play another Pick 2 to pass it on with +2. |
| **Value 5** (Pick 3) | Next player draws 3 cards. Stackable with other Pick 3s. |
| **Value 8** (Suspension) | Next player loses their turn. |
| **Value 14** (General Market) | All other players draw 1 card each. |
| **WHOT** (Wildcard) | Can be played on anything. Player declares the next required shape. |

### Star Card Special Effects

| Star Card | Effect |
|-----------|--------|
| Star 7 | Pick 2 |
| Star 8 | Pick 3 |
| Star 4, Star 5 | Suspension |

---

## AI Agent Strategy

The AI agent uses a **multi-layered scoring system** to make strategic decisions, not random moves.

### Decision Pipeline

```
Hand Assessment → Valid Moves Filter → Score Each Move → Sort by Score → Execute Best
```

### Scoring System

Each playable card is scored based on multiple factors:

```
Score = (suit_chain_bonus)     // Cards that chain into more plays from same suit
      + (action_card_value)    // Context-dependent value of action cards
      + (endgame_bonus)        // Bonus when hand is small (≤3 cards)
      + (market_pressure)      // Bonus when market is running low (<10 cards)
      + (base_value)           // Small bonus for higher-value cards
```

### Tactical Behaviors

| Situation | Agent Behavior |
|-----------|---------------|
| **Opponent has ≤2 cards** | Prioritizes Pick 2/Pick 3 to disrupt their win (+50 score) |
| **Opponent has ≤2 cards** | Prioritizes Suspension to skip their turn (+40 score) |
| **Opponent has many cards** | De-prioritizes action cards, plays for suit chains |
| **Own hand ≤3 cards** | Endgame mode — every play gets +10 bonus |
| **Market < 10 cards** | Pressure mode — +15 bonus to accelerate game |
| **WHOT wildcard timing** | Saved for critical moments (hand ≤3: +35, otherwise: +5) |
| **Suit chain optimization** | Plays cards from suits where hand has most remaining cards |
| **Penalty stacking** | When hit with Pick 2/3, plays matching penalty card to stack if available |

### WHOT Wildcard Shape Selection

When playing a WHOT wildcard, the agent declares the shape it holds the most of (excluding Stars and other WHOTs), maximizing follow-up plays.

### Play Styles

Each turn, the agent rolls a random style — **aggressive** (favors action cards against weak opponents) or **strategic** (favors suit chains and board control). This introduces natural variation without sacrificing quality.

---

## Smart Contract

### WhotArenaV3.sol

The V3 contract uses **ERC-20 $WHOT tokens** for all wagers instead of native MON.

```
WhotArenaV3
├── createMatch(maxPlayers, wagerAmount)  → Escrow $WHOT, create lobby
├── joinMatch(matchId)                     → Escrow $WHOT, join lobby
├── resolveMatch(id, winner, condition,    → Settle match, pay winner
│                scores, gameHash)
├── cancelMatch(matchId)                   → Refund all $WHOT wagers
├── getMatch(matchId)                      → View match details
├── getOpenMatches()                       → List open lobbies
├── getPlayerStats(address)                → Win/loss/wager stats
└── withdrawFees()                         → Arbiter collects 5% fees
```

### Match States

```
Open → Active → Resolved
  │               
  └→ Cancelled (refund all wagers)
```

| State | Description |
|-------|-------------|
| `Open` | Waiting for players to join. Wagers escrowed. |
| `Active` | All players joined. Game in progress. |
| `Resolved` | Game finished. Winner paid. Scores recorded. |
| `Cancelled` | Match cancelled by creator or arbiter. All wagers refunded. |

### Win Conditions

| Condition | Description |
|-----------|-------------|
| `EmptyHand` | A player played all their cards first |
| `MarketExhaustion` | Market ran out of cards — lowest hand score wins |

### Fee Structure

- **5% protocol fee** (500 basis points) deducted from total pot
- Winner receives **95% of pot** in $WHOT tokens
- Fees are accumulated and withdrawable by the arbiter

### Events Emitted

```solidity
event MatchCreated(uint256 indexed matchId, address indexed creator, uint256 maxPlayers, uint256 wagerPerPlayer);
event PlayerJoined(uint256 indexed matchId, address indexed player, uint256 currentPlayers);
event MatchStarted(uint256 indexed matchId, address[] players);
event MatchResolved(uint256 indexed matchId, address indexed winner, WinCondition condition, bytes32 gameHash);
event MatchCancelled(uint256 indexed matchId);
event Payout(address indexed player, uint256 amount);
```

---

## Architecture

```
┌──────────────────┐     ┌──────────────────┐
│   Browser A       │     │   Browser B       │
│                    │     │                    │
│  React Frontend    │     │  React Frontend    │
│  ┌──────────────┐ │     │ ┌──────────────┐  │
│  │ WHOT Engine  │ │     │ │ WHOT Engine  │  │
│  │ (seed: #51)  │ │     │ │ (seed: #51)  │  │
│  │              │ │     │ │              │  │
│  │ Same shuffle │◄┼─────┼►│ Same shuffle │  │
│  │ Same deals   │ │     │ │ Same deals   │  │
│  │ Same game    │ │     │ │ Same game    │  │
│  └──────────────┘ │     │ └──────────────┘  │
│         │          │     │        │           │
│         ▼          │     │        ▼           │
│  MetaMask / Wallet │     │ MetaMask / Wallet  │
└────────┬───────────┘     └────────┬───────────┘
         │                          │
         ▼                          ▼
┌─────────────────────────────────────────────┐
│              Monad Blockchain                 │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │           WhotArenaV3 Contract           │ │
│  │                                           │ │
│  │  Match #51                                │ │
│  │  ├── Players: [0x3fe4..., 0x9787...]     │ │
│  │  ├── Wager: 100 $WHOT each               │ │
│  │  ├── State: Active → Resolved            │ │
│  │  ├── Winner: 0x3fe4...                   │ │
│  │  ├── Scores: [0, 42]                     │ │
│  │  └── GameHash: 0xabc123...               │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │         $WHOT Token (ERC-20)             │ │
│  │         Launched on nad.fun              │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Why No Server?

The game engine is **fully deterministic**. Given the same seed (match ID) and same player order (from the contract's `players` array), both browsers produce identical deck shuffles, card deals, and AI decisions. This means:

- No game server needed
- No WebSocket connections
- No trust assumptions
- Both clients independently verify the same game state
- The on-chain game hash proves the game was played correctly

### Deterministic RNG

The engine uses a **Mulberry32** seeded PRNG, initialized with:

```
seed = matchId * 2654435761 (Knuth's multiplicative hash)
```

This ensures every random operation (shuffle, AI decisions) produces identical results on both browsers.

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | React 18 + Vite 5 | UI and game rendering |
| Blockchain | Monad Mainnet (Chain ID 143) | Settlement and state storage |
| Smart Contract | Solidity 0.8.20 (WhotArenaV3) | Wager escrow and payout |
| Token | $WHOT (ERC-20 on nad.fun) | Wager currency |
| Web3 | ethers.js 6.9.0 (CDN) | Wallet and contract interaction |
| Game Engine | Custom JavaScript (class Eng) | Deterministic WHOT game logic |
| AI Agent | Scoring-based decision engine | Strategic card play |
| Hosting | Render (Static Site) | Frontend deployment |
| RNG | Mulberry32 (seeded) | Deterministic randomness |

---

## Getting Started

### Prerequisites

- Node.js 18+
- MetaMask (or any EVM wallet) connected to Monad Mainnet
- $WHOT tokens in your wallet

### Installation

```bash
git clone https://github.com/shrooms08/whot-arena.git
cd whot-arena
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Configuration

Update `src/whot-app.jsx` lines 4-5 with your deployed addresses:

```javascript
const V2 = "0x_YOUR_V3_CONTRACT_ADDRESS";
const WHOT_TOKEN = "0x_YOUR_WHOT_TOKEN_ADDRESS";
```

### Adding Monad to MetaMask

| Setting | Value |
|---------|-------|
| Network Name | Monad |
| RPC URL | `https://rpc.monad.xyz` |
| Chain ID | 143 |
| Currency Symbol | MON |
| Explorer | `https://monadscan.com` |

---

## Deployment

### 1. Launch $WHOT Token

Go to [nad.fun](https://nad.fun) → Create Token → Set name, symbol, description → Pay 10 MON creation fee.

### 2. Deploy WhotArenaV3 Contract

```bash
cd deploy
npm install
```

Create `deploy/.env`:

```env
PRIVATE_KEY=your_private_key
WHOT_TOKEN=0x_token_address_from_nadfun
```

```bash
node deploy-v3.js
```

### 3. Update Frontend

Set the deployed addresses in `src/whot-app.jsx` (lines 4-5).

### 4. Deploy to Render

```bash
git add -A
git commit -m "Set contract addresses"
git push
```

On [render.com](https://render.com):
- New → Static Site → Connect GitHub repo
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

---

## Project Structure

```
whot-arena/
├── src/
│   ├── whot-app.jsx          # Main app: UI, game engine, AI agent, contract interaction
│   └── main.jsx              # React entry point
├── deploy/
│   ├── build/
│   │   ├── WhotArenaV3.abi   # Compiled contract ABI
│   │   └── WhotArenaV3.bin   # Compiled contract bytecode
│   ├── deploy-v3.js          # Deployment script for Monad mainnet
│   ├── deploy.js             # Legacy V2 deployment script
│   └── .env.example          # Environment template
├── WhotArenaV3.sol            # V3 smart contract (ERC-20 wagers)
├── WhotArenaV2.sol            # V2 smart contract (native MON wagers)
├── on-chain-bridge-v2.js      # On-chain bridge utilities
├── index.html                 # HTML entry point (loads ethers.js CDN)
├── vite.config.js             # Vite configuration
├── package.json               # Dependencies
└── README.md                  # This file
```

### Key Components in whot-app.jsx

| Component | Purpose |
|-----------|---------|
| `Eng` (class) | Deterministic WHOT game logic with seeded RNG |
| `doAI()` | Multi-factor card scoring and strategic play |
| `GameView` | Real-time game display with card counts and event log |
| `CreateLobby` | Token approval + match creation flow |
| `OpenLobbies` | Lists open matches, handles joining with approval |
| `Leaderboard` | On-chain win/loss/wager statistics |
| `connectWallet()` | MetaMask integration with Monad chain switching |

---

## Monad Integration

WHOT Arena leverages Monad's high-performance EVM at every layer:

- **Sub-second finality (~1s blocks):** Real-time lobby synchronization — players see each other join almost instantly. On Ethereum's 12s blocks, this would feel sluggish.
- **Low gas fees (~NGN 0.20 per tx):** Makes micro-wager games economically viable. Each match involves 4-6 transactions (approve × 2 + create + join + resolve + potential cancel).
- **Parallel execution:** Multiple concurrent matches without gas spikes — critical for a gaming platform with many active lobbies.
- **Full EVM compatibility:** Standard Solidity contract, ethers.js frontend, MetaMask wallet — familiar tooling, deployed on a 10,000 TPS chain.
- **nad.fun ecosystem:** $WHOT token launched on Monad's native token launchpad, keeping the entire economy within the Monad ecosystem.
- **On-chain verifiability:** Every match result (winner, scores, game hash) is permanently recorded on Monad for transparent, trustless verification.

---

## Security

### Smart Contract

- **No reentrancy risk:** Token transfers use `transfer()` / `transferFrom()` (ERC-20 standard), not raw ETH `call{value:}`
- **Access control:** Only the arbiter can resolve matches and withdraw fees
- **Player validation:** Contract verifies winner is a match participant
- **Score verification:** Player scores array must match player count
- **Wager matching:** Joiners must approve the exact wager amount set by the creator
- **Cancellation refunds:** All escrowed tokens returned if match is cancelled
- **Fee cap:** Protocol fee is capped at 500 basis points (5%)

### Game Integrity

- **Deterministic engine:** Both clients compute identical game states from the on-chain seed
- **Game hash:** SHA-256 hash of the complete game log stored on-chain for verification
- **No hidden state:** All game logic is open source and reproducible
- **Turn limit:** 300-turn cap prevents infinite games

---

## Roadmap

- [x] Core WHOT game engine with full ruleset
- [x] AI agent with strategic card play
- [x] On-chain wagering (V2: native MON)
- [x] ERC-20 token wagering (V3: $WHOT)
- [x] $WHOT token launch on nad.fun
- [x] Monad mainnet deployment
- [x] On-chain leaderboard
- [x] Live hosting on Render
- [ ] Tournament mode with brackets and prize pools
- [ ] ELO-based ranked matchmaking
- [ ] Mobile-optimized responsive UI
- [ ] Spectator mode for live matches
- [ ] Multiple AI difficulty levels
- [ ] Chat/emotes during matches

---

## License

MIT

---


*WHOT Arena — bringing West Africa's favorite card game to the blockchain.*
