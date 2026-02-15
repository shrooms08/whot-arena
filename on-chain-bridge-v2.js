/**
 * WHOT Arena V2 — On-Chain Bridge
 * Connects 2-4 player game engine to WhotArenaV2 smart contract on Monad.
 * 
 * Flow:
 *   1. Agent creates match on-chain (escrows wager, sets player count)
 *   2. Other agents join match on-chain (match wager)
 *   3. Game engine runs the match off-chain (2-4 players)
 *   4. Arbiter submits result on-chain (winner gets pot)
 * 
 * Win conditions:
 *   - EmptyHand: First player to empty their hand wins
 *   - MarketExhaustion: Market runs out, lowest hand score wins
 * 
 * Usage:
 *   node src/bridge/on-chain-bridge-v2.js demo
 *   node src/bridge/on-chain-bridge-v2.js run-match 0.01 2
 *   node src/bridge/on-chain-bridge-v2.js run-match 0.01 4
 *   node src/bridge/on-chain-bridge-v2.js run-series 5 0.005 3
 */

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════
// EMBEDDED GAME ENGINE (2-4 players, market exhaustion)
// ═══════════════════════════════════════════

const SHAPES = ["circle", "square", "triangle", "cross"];
const STAR_EFFECTS = {
  1: { type: "draw", count: 1 }, 2: { type: "draw", count: 2 }, 3: { type: "draw", count: 3 },
  4: { type: "suspension" }, 5: { type: "suspension" }, 6: { type: "general_market" },
  7: { type: "pick2", count: 2 }, 8: { type: "pick3", count: 3 },
};

function createCard(shape, value, id) {
  const card = { id, shape, value, display: `${shape.toUpperCase()} ${value}` };
  if (shape === "whot") { card.effect = { type: "whot" }; card.score = 50; }
  else if (shape === "star") { card.effect = STAR_EFFECTS[value]; card.score = 20; }
  else if (value === 2) { card.effect = { type: "pick2", count: 2 }; card.score = 20; }
  else if (value === 5) { card.effect = { type: "pick3", count: 3 }; card.score = 20; }
  else if (value === 8) { card.effect = { type: "suspension" }; card.score = 20; }
  else if (value === 14) { card.effect = { type: "general_market" }; card.score = 20; }
  else { card.effect = null; card.score = value; }
  return card;
}

function buildDeck() {
  const cards = []; let id = 0;
  for (const s of SHAPES) for (let v = 1; v <= 14; v++) cards.push(createCard(s, v, id++));
  for (let v = 1; v <= 8; v++) cards.push(createCard("star", v, id++));
  for (let i = 0; i < 4; i++) cards.push(createCard("whot", 20, id++));
  return cards;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class GameEngine {
  constructor(players) {
    this.players = players;
    this.numPlayers = players.length;
    this.hands = {};
    this.market = [];
    this.playPile = [];
    this.currentIndex = 0;
    this.declaredShape = null;
    this.pendingEffect = null;
    this.state = "waiting";
    this.winner = null;
    this.scores = {};
    this.winCondition = null; // "empty_hand" or "market_exhaustion"
    this.turnCount = 0;
    this.log = [];
  }

  start() {
    let deck = shuffle(buildDeck());
    for (const p of this.players) this.hands[p] = deck.splice(0, 5);
    this.market = deck;
    let startCard = null, attempts = 0;
    while (!startCard && attempts < 50) {
      const c = this.market.shift();
      const isAction = c.shape === "whot" || (c.effect && ["pick2", "pick3", "suspension", "general_market"].includes(c.effect.type));
      if (!isAction) startCard = c;
      else { this.market.push(c); this.market = shuffle(this.market); }
      attempts++;
    }
    this.playPile = [startCard];
    this.state = "playing";
    this._log(`Game started (${this.numPlayers}P). Market: ${this.market.length} cards. Top: ${startCard.display}`);
    return startCard;
  }

  current() { return this.players[this.currentIndex]; }
  top() { return this.playPile[this.playPile.length - 1]; }
  nextPlayer() { return this.players[(this.currentIndex + 1) % this.numPlayers]; }
  advance(skip) { this.currentIndex = (this.currentIndex + (skip || 1)) % this.numPlayers; }
  handScore(pid) { return (this.hands[pid] || []).reduce((s, c) => s + c.value, 0); }
  marketEmpty() { return this.market.length === 0; }

  canPlay(card) {
    const t = this.top();
    if (card.shape === "whot") return true;
    if (this.declaredShape) return card.shape === this.declaredShape;
    if (this.pendingEffect) {
      if (this.pendingEffect.type === "pick2" && card.value === 2 && card.shape !== "star" && card.shape !== "whot") return true;
      if (this.pendingEffect.type === "pick3" && card.value === 5 && card.shape !== "star" && card.shape !== "whot") return true;
      return false;
    }
    return card.shape === t.shape || card.value === t.value;
  }

  validPlays(pid) { return (this.hands[pid] || []).filter(c => this.canPlay(c)); }

  drawCards(n) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (!this.market.length) break; // No recycling — market exhaustion
      drawn.push(this.market.shift());
    }
    return drawn;
  }

  checkMarketEnd() {
    if (!this.marketEmpty()) return null;
    this.state = "finished";
    this.winCondition = "market_exhaustion";
    for (const p of this.players) this.scores[p] = this.handScore(p);
    let best = null, bestScore = Infinity;
    for (const p of this.players) {
      if (this.scores[p] < bestScore) { bestScore = this.scores[p]; best = p; }
    }
    this.winner = best;
    this._log(`MARKET EMPTY! Scores: ${this.players.map(p => `${p}:${this.scores[p]}`).join(", ")} | ${best} WINS (lowest)`);
    return { event: "market_end", scores: this.scores, winner: best };
  }

  _log(msg) { this.log.push({ turn: this.turnCount, msg, ts: Date.now() }); }

  exec(pid, action) {
    if (this.state !== "playing" || pid !== this.current() || this.turnCount > 300) return null;
    this.turnCount++;

    // Accept penalty
    if (this.pendingEffect && action.type !== "play") {
      const n = this.pendingEffect.count || 0;
      const drawn = this.drawCards(n);
      this.hands[pid].push(...drawn);
      this._log(`${pid} accepts ${drawn.length}-card penalty`);
      this.pendingEffect = null;
      const me = this.checkMarketEnd(); if (me) return me;
      this.advance(); return { event: "penalty", count: drawn.length };
    }

    // Stack on penalty
    if (this.pendingEffect && action.type === "play") {
      const ci = this.hands[pid].findIndex(c => c.id === action.cardId);
      if (ci === -1) return null;
      const card = this.hands[pid][ci];
      if (!this.canPlay(card)) return null;
      this.hands[pid].splice(ci, 1); this.playPile.push(card); this.declaredShape = null;
      const newCount = (this.pendingEffect.count || 0) + (card.effect?.count || (card.value === 2 ? 2 : 3));
      this._log(`${pid} stacks ${card.display}! Penalty: ${newCount}`);
      if (!this.hands[pid].length) {
        this.state = "finished"; this.winner = pid; this.winCondition = "empty_hand";
        for (const pp of this.players) this.scores[pp] = this.handScore(pp);
        return { event: "win", card };
      }
      this.pendingEffect = { type: this.pendingEffect.type, count: newCount };
      this.advance(); return { event: "stack", card, count: newCount };
    }

    // Play card
    if (action.type === "play") {
      const ci = this.hands[pid].findIndex(c => c.id === action.cardId);
      if (ci === -1) return null;
      const card = this.hands[pid][ci];
      if (!this.canPlay(card)) return null;
      this.hands[pid].splice(ci, 1); this.playPile.push(card); this.declaredShape = null;
      this._log(`${pid} plays ${card.display}`);

      if (!this.hands[pid].length) {
        this.state = "finished"; this.winner = pid; this.winCondition = "empty_hand";
        const np = this.nextPlayer();
        if (card.effect && (card.effect.type === "pick2" || card.effect.type === "pick3"))
          this.hands[np].push(...this.drawCards(card.effect.count));
        for (const pp of this.players) this.scores[pp] = this.handScore(pp);
        return { event: "win", card };
      }

      if (card.effect) {
        switch (card.effect.type) {
          case "pick2": this.pendingEffect = { type: "pick2", count: 2 }; this.advance(); return { event: "pick", card };
          case "pick3": this.pendingEffect = { type: "pick3", count: 3 }; this.advance(); return { event: "pick", card };
          case "suspension": this.advance(2); return { event: "suspension", card };
          case "general_market":
            for (let j = 1; j < this.numPlayers; j++) {
              const tp = this.players[(this.currentIndex + j) % this.numPlayers];
              this.hands[tp].push(...this.drawCards(1));
            }
            { const me = this.checkMarketEnd(); if (me) return me; }
            this.advance(); return { event: "general_market", card };
          case "draw": {
            const np = this.nextPlayer();
            this.hands[np].push(...this.drawCards(card.effect.count));
            const me = this.checkMarketEnd(); if (me) return me;
            this.advance(); return { event: "star_draw", card };
          }
          case "whot":
            this.declaredShape = action.declaredShape || "circle"; this.advance();
            return { event: "whot", card, declaredShape: this.declaredShape };
        }
      }
      this.advance(); return { event: "play", card };
    }

    // Draw
    if (action.type === "draw") {
      if (this.marketEmpty()) {
        const me = this.checkMarketEnd(); if (me) return me;
        this.advance(); return { event: "empty" };
      }
      const drawn = this.drawCards(1);
      if (!drawn.length) { this.advance(); return { event: "empty" }; }
      this.hands[pid].push(...drawn);
      this._log(`${pid} draws from market`);
      const me = this.checkMarketEnd(); if (me) return me;
      if (this.canPlay(drawn[0])) return { event: "drawn_playable", card: drawn[0] };
      this.advance(); return { event: "drawn" };
    }

    return null;
  }
}

// ═══════════════════════════════════════════
// AI AGENT
// ═══════════════════════════════════════════

function agentDecide(engine, pid) {
  const hand = engine.hands[pid] || [];
  const valid = engine.validPlays(pid);
  // Randomly assign internal style per decision for variety
  const style = Math.random() > 0.5 ? "aggressive" : "strategic";

  if (engine.pendingEffect) {
    if (valid.length > 0) return { type: "play", cardId: valid[0].id };
    return { type: "accept_penalty" };
  }
  if (!valid.length) return { type: "draw" };

  let totalOpp = 0;
  for (const pp of engine.players) if (pp !== pid) totalOpp += (engine.hands[pp] || []).length;
  const avgOpp = totalOpp / (engine.numPlayers - 1);

  const scored = valid.map(card => {
    let score = 0;
    const shapeCounts = {};
    for (const c of hand) if (c.shape !== "whot" && c.shape !== "star") shapeCounts[c.shape] = (shapeCounts[c.shape] || 0) + 1;
    if (card.shape !== "whot" && card.shape !== "star") score += (shapeCounts[card.shape] || 0) * 2;
    if (card.effect) {
      switch (card.effect.type) {
        case "pick2": case "pick3":
          if (avgOpp <= 2) score += 50; else if (avgOpp <= 4) score += 25;
          else if (style === "aggressive") score += 15; else score -= 10; break;
        case "suspension": score += avgOpp <= 2 ? 40 : 8; break;
        case "general_market": score += avgOpp <= 3 ? 20 : 5; break;
        case "draw": score += card.effect.count * 5; break;
        case "whot": if (hand.length <= 3) score += 35; else score += 5; break;
      }
    }
    if (hand.length <= 3) score += 10;
    if (engine.market.length < 10) score += 15; // Urgency when market low
    score += card.value * 0.3;
    return { card, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].card;
  const action = { type: "play", cardId: best.id };

  if (best.shape === "whot") {
    const remaining = hand.filter(c => c.id !== best.id);
    const sc = {};
    for (const c of remaining) if (c.shape !== "whot" && c.shape !== "star") sc[c.shape] = (sc[c.shape] || 0) + 1;
    let bestShape = "circle", bestCount = -1;
    for (const s of SHAPES) if ((sc[s] || 0) > bestCount) { bestCount = sc[s] || 0; bestShape = s; }
    action.declaredShape = bestShape;
  }
  return action;
}

function runOffChainMatch(playerNames) {
  const engine = new GameEngine(playerNames);
  engine.start();
  let safety = 0;

  while (engine.state === "playing" && safety < 500) {
    safety++;
    const pid = engine.current();
    const action = agentDecide(engine, pid);
    const result = engine.exec(pid, action);
    if (!result) {
      const fallback = engine.pendingEffect ? { type: "accept_penalty" } : { type: "draw" };
      engine.exec(pid, fallback);
      continue;
    }
    if (result.event === "drawn_playable" && result.card) {
      const followAction = { type: "play", cardId: result.card.id };
      if (result.card.shape === "whot") {
        const h = engine.hands[pid] || [];
        const sc = {};
        for (const c of h) if (c.shape !== "whot" && c.shape !== "star") sc[c.shape] = (sc[c.shape] || 0) + 1;
        let bs = "circle", bc = -1;
        for (const s of SHAPES) if ((sc[s] || 0) > bc) { bc = sc[s] || 0; bs = s; }
        followAction.declaredShape = bs;
      }
      engine.exec(pid, followAction);
    }
    if (result.event === "win" || result.event === "market_end") break;
  }

  return {
    winner: engine.winner,
    winCondition: engine.winCondition,
    scores: engine.scores,
    turns: engine.turnCount,
    marketRemaining: engine.market.length,
    log: engine.log,
    gameHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(engine.log))),
  };
}

// ═══════════════════════════════════════════
// ON-CHAIN BRIDGE (V2 — 2-4 players)
// ═══════════════════════════════════════════

const RPC_URL = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const CHAIN_ID = 10143;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS_V2 || process.env.CONTRACT_ADDRESS;

function loadABI() {
  const paths = [
    path.resolve(__dirname, "../../build/WhotArenaV2.abi"),
    path.resolve(__dirname, "../../../whot-contracts/build/WhotArenaV2.abi"),
    path.resolve(process.cwd(), "build/WhotArenaV2.abi"),
  ];
  for (const p of paths) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  }
  throw new Error("Cannot find WhotArenaV2.abi");
}

class OnChainBridgeV2 {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
    this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
    this.abi = loadABI();
    this.contract = new ethers.Contract(CONTRACT_ADDRESS, this.abi, this.wallet);
    this.matchResults = [];

    // Create agent wallets (up to 3 additional agents)
    this.agentWallets = [];
    this.agentContracts = [];
    for (let i = 0; i < 3; i++) {
      const envKey = `PRIVATE_KEY_AGENT${i + 2}`;
      const w = process.env[envKey]
        ? new ethers.Wallet(process.env[envKey], this.provider)
        : ethers.Wallet.createRandom().connect(this.provider);
      this.agentWallets.push(w);
      this.agentContracts.push(new ethers.Contract(CONTRACT_ADDRESS, this.abi, w));
    }
  }

  async getBalance() {
    const bal = await this.provider.getBalance(this.wallet.address);
    return ethers.formatEther(bal);
  }

  async ensureAgentFunded(wallet, amountMON = "0.05") {
    const bal = await this.provider.getBalance(wallet.address);
    const needed = ethers.parseEther(amountMON);
    if (bal < needed) {
      console.log(`   Funding ${wallet.address.slice(0, 10)}...`);
      const tx = await this.wallet.sendTransaction({ to: wallet.address, value: needed });
      await tx.wait();
      console.log(`   Sent ${amountMON} MON`);
    }
  }

  async runOnChainMatch(wagerMON = "0.01", numPlayers = 2) {
    numPlayers = Math.max(2, Math.min(4, numPlayers));
    const wagerWei = ethers.parseEther(wagerMON);
    const agentNames = ["Agent-1", "Agent-2", "Agent-3", "Agent-4"].slice(0, numPlayers);

    console.log(`\n${"=".repeat(55)}`);
    console.log(`  WHOT MATCH -- ${numPlayers}P -- ${wagerMON} MON WAGER`);
    console.log(`${"=".repeat(55)}\n`);

    // Fund agent wallets
    for (let i = 0; i < numPlayers - 1; i++) {
      await this.ensureAgentFunded(this.agentWallets[i], String(parseFloat(wagerMON) * 3));
    }

    // Step 1: Creator creates match
    console.log(`1. ${agentNames[0]} creating ${numPlayers}P match...`);
    const createTx = await this.contract.createMatch(numPlayers, { value: wagerWei });
    await createTx.wait();
    const matchId = await this.contract.matchCount();
    console.log(`   Match #${matchId} created (tx: ${createTx.hash.slice(0, 18)}...)`);
    console.log(`   Escrowed: ${wagerMON} MON\n`);

    // Step 2: Other agents join
    for (let i = 0; i < numPlayers - 1; i++) {
      console.log(`2.${i + 1} ${agentNames[i + 1]} joining match...`);
      const joinTx = await this.agentContracts[i].joinMatch(matchId, { value: wagerWei });
      await joinTx.wait();
      console.log(`   Joined (tx: ${joinTx.hash.slice(0, 18)}...)\n`);
    }
    console.log(`   Total pot: ${parseFloat(wagerMON) * numPlayers} MON\n`);

    // Step 3: Run game off-chain
    console.log("3. Running WHOT game off-chain...");
    const result = runOffChainMatch(agentNames);
    console.log(`   Finished in ${result.turns} turns`);
    console.log(`   Win condition: ${result.winCondition}`);
    console.log(`   Winner: ${result.winner}`);
    if (result.scores) {
      console.log(`   Scores: ${Object.entries(result.scores).map(([n, s]) => `${n}:${s}`).join(", ")}`);
    }
    console.log(`   Game hash: ${result.gameHash.slice(0, 18)}...\n`);

    // Step 4: Arbiter settles on-chain
    console.log("4. Arbiter settling result on-chain...");
    const winnerIdx = agentNames.indexOf(result.winner);
    const winnerAddress = winnerIdx === 0 ? this.wallet.address : this.agentWallets[winnerIdx - 1].address;

    // Build scores array in same order as players
    const playerScores = agentNames.map(n => result.scores[n] || 0);

    // WinCondition enum: 0 = EmptyHand, 1 = MarketExhaustion
    const winConditionEnum = result.winCondition === "market_exhaustion" ? 1 : 0;

    const resolveTx = await this.contract.resolveMatch(
      matchId,
      winnerAddress,
      winConditionEnum,
      playerScores,
      result.gameHash
    );
    await resolveTx.wait();
    console.log(`   Match resolved (tx: ${resolveTx.hash.slice(0, 18)}...)`);
    console.log(`   Payout -> ${result.winner} (${winnerAddress.slice(0, 14)}...)\n`);

    // Step 5: Verify
    console.log("5. Verifying on-chain...");
    const onChainMatch = await this.contract.getMatch(matchId);
    const states = ["Open", "Active", "Resolved", "Cancelled"];
    const conditions = ["EmptyHand", "MarketExhaustion"];
    console.log(`   Match #${matchId}: ${states[Number(onChainMatch.state)]}`);
    console.log(`   Winner: ${onChainMatch.winner}`);
    console.log(`   Win Condition: ${conditions[Number(onChainMatch.winCondition)]}`);
    console.log(`   Players: ${onChainMatch.currentPlayers}/${onChainMatch.maxPlayers}`);
    console.log(`   Explorer: https://testnet.monadexplorer.com/address/${CONTRACT_ADDRESS}\n`);

    const matchResult = {
      matchId: Number(matchId),
      winner: result.winner,
      winCondition: result.winCondition,
      scores: result.scores,
      turns: result.turns,
      wager: wagerMON,
      numPlayers,
      gameHash: result.gameHash,
    };
    this.matchResults.push(matchResult);
    return matchResult;
  }

  async runSeries(count = 5, wagerMON = "0.005", numPlayers = 2) {
    console.log("======================================");
    console.log(`  WHOT ARENA V2 -- ${count}-Match Series (${numPlayers}P)`);
    console.log("======================================\n");

    const balance = await this.getBalance();
    console.log(`Wallet: ${this.wallet.address}`);
    console.log(`Balance: ${balance} MON`);
    console.log(`Contract: ${CONTRACT_ADDRESS}`);
    console.log(`Wager/match: ${wagerMON} MON x ${numPlayers} players\n`);

    const wins = {};

    for (let i = 0; i < count; i++) {
      try {
        const result = await this.runOnChainMatch(wagerMON, numPlayers);
        wins[result.winner] = (wins[result.winner] || 0) + 1;
      } catch (err) {
        console.error(`   Match ${i + 1} failed: ${err.message}\n`);
      }
    }

    console.log("======================================");
    console.log("  SERIES RESULTS");
    console.log("======================================\n");
    for (const [name, w] of Object.entries(wins).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${name}: ${w}W / ${count - w}L`);
    }
    console.log(`\n   Total on-chain matches: ${this.matchResults.length}`);
    console.log(`   Contract: ${CONTRACT_ADDRESS}\n`);

    const playerStats = await this.contract.getPlayerStats(this.wallet.address);
    console.log("   On-Chain Stats (Agent-1):");
    console.log(`   Wins: ${playerStats.wins} | Losses: ${playerStats.losses}`);
    console.log(`   Games: ${playerStats.gamesPlayed}`);
    console.log(`   Total Wagered: ${ethers.formatEther(playerStats.totalWagered)} MON`);
    console.log(`   Total Won: ${ethers.formatEther(playerStats.totalWon)} MON\n`);

    return { wins, matchResults: this.matchResults };
  }

  async demo() {
    console.log("======================================");
    console.log("  WHOT ARENA V2 -- Live Demo on Monad");
    console.log("======================================\n");
    console.log("4 AI agents play WHOT with real token wagers.\n");
    console.log(`Agent 1: ${this.wallet.address}`);
    for (let i = 0; i < 3; i++) console.log(`Agent ${i + 2}: ${this.agentWallets[i].address}`);
    console.log(`Arbiter: ${this.wallet.address}\n`);

    await this.runOnChainMatch("0.01", 4);

    console.log("Demo complete! 4-player WHOT match recorded on Monad.\n");
  }
}

// ═══════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════

const [,, command, ...args] = process.argv;

if (!CONTRACT_ADDRESS) {
  console.error("Set CONTRACT_ADDRESS_V2 or CONTRACT_ADDRESS in .env");
  process.exit(1);
}
if (!process.env.PRIVATE_KEY) {
  console.error("Set PRIVATE_KEY in .env");
  process.exit(1);
}

const bridge = new OnChainBridgeV2();

switch (command) {
  case "demo":
    await bridge.demo();
    break;
  case "run-match":
    await bridge.runOnChainMatch(args[0] || "0.01", parseInt(args[1]) || 2);
    break;
  case "run-series":
    await bridge.runSeries(parseInt(args[0]) || 5, args[1] || "0.005", parseInt(args[2]) || 2);
    break;
  default:
    console.log(`
WHOT Arena V2 -- On-Chain Bridge

Commands:
  demo                          4-player demo match
  run-match <wager> <players>   Single match (e.g. run-match 0.01 4)
  run-series <n> <wager> <P>    Series (e.g. run-series 5 0.005 3)
`);
}
