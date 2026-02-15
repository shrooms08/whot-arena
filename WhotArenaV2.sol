// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title WhotArenaV2
 * @notice 2-4 player wagering contract for WHOT card game on Monad
 * @dev Escrow-based wagering with multiplayer support, market exhaustion, and OpenClaw agent integration
 */
contract WhotArenaV2 {

    // === STRUCTS ===
    struct Match {
        uint256 id;
        uint256 maxPlayers;       // 2-4
        uint256 wagerPerPlayer;
        address[] players;
        address winner;
        uint256 winnerScore;      // Winner's hand score (lowest wins on market exhaustion)
        MatchState state;
        WinCondition winCondition;
        uint256 createdAt;
        uint256 resolvedAt;
        bytes32 gameHash;
        mapping(address => uint256) scores; // Final hand scores per player
    }

    enum MatchState {
        Open,       // Waiting for players to fill
        Active,     // All players joined, game in progress
        Resolved,   // Game finished, winner determined
        Cancelled   // Match cancelled
    }

    enum WinCondition {
        EmptyHand,       // Player emptied their hand first
        MarketExhaustion // Market ran out, lowest score wins
    }

    struct PlayerStats {
        uint256 wins;
        uint256 losses;
        uint256 totalWagered;
        uint256 totalWon;
        uint256 totalLost;
        uint256 gamesPlayed;
    }

    struct MatchView {
        uint256 id;
        uint256 maxPlayers;
        uint256 currentPlayers;
        uint256 wagerPerPlayer;
        address[] players;
        address winner;
        uint256 winnerScore;
        MatchState state;
        WinCondition winCondition;
        uint256 createdAt;
        uint256 resolvedAt;
        bytes32 gameHash;
    }

    // === STATE ===
    address public arbiter;
    uint256 public matchCount;
    uint256 public feePercent; // Basis points (100 = 1%)
    uint256 public totalFeesCollected;

    mapping(uint256 => Match) internal _matches;
    mapping(address => uint256[]) public playerMatches;
    mapping(address => PlayerStats) public playerStats;

    // === EVENTS ===
    event MatchCreated(uint256 indexed matchId, address indexed creator, uint256 maxPlayers, uint256 wagerPerPlayer);
    event PlayerJoined(uint256 indexed matchId, address indexed player, uint256 currentPlayers);
    event MatchStarted(uint256 indexed matchId, address[] players);
    event MatchResolved(uint256 indexed matchId, address indexed winner, WinCondition condition, bytes32 gameHash);
    event MatchCancelled(uint256 indexed matchId);
    event Payout(address indexed player, uint256 amount);

    // === MODIFIERS ===
    modifier onlyArbiter() {
        require(msg.sender == arbiter, "Only arbiter");
        _;
    }

    // === CONSTRUCTOR ===
    constructor(uint256 _feePercent) {
        arbiter = msg.sender;
        feePercent = _feePercent;
    }

    // === MATCH LIFECYCLE ===

    /**
     * @notice Create a new match (2-4 players)
     * @param _maxPlayers Number of players (2-4)
     */
    function createMatch(uint256 _maxPlayers) external payable returns (uint256) {
        require(msg.value > 0, "Wager must be > 0");
        require(_maxPlayers >= 2 && _maxPlayers <= 4, "2-4 players only");

        matchCount++;
        Match storage m = _matches[matchCount];
        m.id = matchCount;
        m.maxPlayers = _maxPlayers;
        m.wagerPerPlayer = msg.value;
        m.players.push(msg.sender);
        m.state = MatchState.Open;
        m.createdAt = block.timestamp;

        playerMatches[msg.sender].push(matchCount);

        emit MatchCreated(matchCount, msg.sender, _maxPlayers, msg.value);

        // If 2+ player match and only need creator, check if auto-start needed
        // (won't happen with 2+ but handles edge cases)

        return matchCount;
    }

    /**
     * @notice Join an existing match by matching the wager
     */
    function joinMatch(uint256 _matchId) external payable {
        Match storage m = _matches[_matchId];
        require(m.state == MatchState.Open, "Match not open");
        require(msg.value == m.wagerPerPlayer, "Must match wager");
        require(m.players.length < m.maxPlayers, "Match full");

        // Check player not already in match
        for (uint256 i = 0; i < m.players.length; i++) {
            require(m.players[i] != msg.sender, "Already joined");
        }

        m.players.push(msg.sender);
        playerMatches[msg.sender].push(_matchId);

        emit PlayerJoined(_matchId, msg.sender, m.players.length);

        // Auto-start when full
        if (m.players.length == m.maxPlayers) {
            m.state = MatchState.Active;
            emit MatchStarted(_matchId, m.players);
        }
    }

    /**
     * @notice Submit match result (arbiter only)
     * @param _matchId Match ID
     * @param _winner Address of the winner
     * @param _condition How the game ended (empty hand or market exhaustion)
     * @param _playerScores Array of scores in same order as players array
     * @param _gameHash Hash of complete game log
     */
    function resolveMatch(
        uint256 _matchId,
        address _winner,
        WinCondition _condition,
        uint256[] calldata _playerScores,
        bytes32 _gameHash
    ) external onlyArbiter {
        Match storage m = _matches[_matchId];
        require(m.state == MatchState.Active, "Match not active");
        require(_playerScores.length == m.players.length, "Score count mismatch");

        // Verify winner is a player
        bool winnerFound = false;
        for (uint256 i = 0; i < m.players.length; i++) {
            if (m.players[i] == _winner) winnerFound = true;
            m.scores[m.players[i]] = _playerScores[i];
        }
        require(winnerFound, "Winner not in match");

        m.winner = _winner;
        m.winnerScore = m.scores[_winner];
        m.winCondition = _condition;
        m.gameHash = _gameHash;
        m.state = MatchState.Resolved;
        m.resolvedAt = block.timestamp;

        // Calculate payout
        uint256 totalPot = m.wagerPerPlayer * m.players.length;
        uint256 fee = (totalPot * feePercent) / 10000;
        uint256 payout = totalPot - fee;
        totalFeesCollected += fee;

        // Update stats for all players
        for (uint256 i = 0; i < m.players.length; i++) {
            address p = m.players[i];
            playerStats[p].gamesPlayed++;
            playerStats[p].totalWagered += m.wagerPerPlayer;

            if (p == _winner) {
                playerStats[p].wins++;
                playerStats[p].totalWon += payout;
            } else {
                playerStats[p].losses++;
                playerStats[p].totalLost += m.wagerPerPlayer;
            }
        }

        // Pay winner
        (bool sent, ) = _winner.call{value: payout}("");
        require(sent, "Payout failed");

        emit MatchResolved(_matchId, _winner, _condition, _gameHash);
        emit Payout(_winner, payout);
    }

    /**
     * @notice Cancel an open match — return all wagers
     */
    function cancelMatch(uint256 _matchId) external {
        Match storage m = _matches[_matchId];
        require(m.state == MatchState.Open, "Match not open");
        require(msg.sender == m.players[0] || msg.sender == arbiter, "Not authorized");

        m.state = MatchState.Cancelled;

        // Refund all players who joined
        for (uint256 i = 0; i < m.players.length; i++) {
            (bool sent, ) = m.players[i].call{value: m.wagerPerPlayer}("");
            require(sent, "Refund failed");
        }

        emit MatchCancelled(_matchId);
    }

    // === VIEW FUNCTIONS ===

    function getMatch(uint256 _matchId) external view returns (MatchView memory) {
        Match storage m = _matches[_matchId];
        return MatchView({
            id: m.id,
            maxPlayers: m.maxPlayers,
            currentPlayers: m.players.length,
            wagerPerPlayer: m.wagerPerPlayer,
            players: m.players,
            winner: m.winner,
            winnerScore: m.winnerScore,
            state: m.state,
            winCondition: m.winCondition,
            createdAt: m.createdAt,
            resolvedAt: m.resolvedAt,
            gameHash: m.gameHash
        });
    }

    function getMatchPlayers(uint256 _matchId) external view returns (address[] memory) {
        return _matches[_matchId].players;
    }

    function getPlayerScore(uint256 _matchId, address _player) external view returns (uint256) {
        return _matches[_matchId].scores[_player];
    }

    function getPlayerMatches(address _player) external view returns (uint256[] memory) {
        return playerMatches[_player];
    }

    function getPlayerStats(address _player) external view returns (PlayerStats memory) {
        return playerStats[_player];
    }

    function getOpenMatches() external view returns (uint256[] memory) {
        uint256 openCount = 0;
        for (uint256 i = 1; i <= matchCount; i++) {
            if (_matches[i].state == MatchState.Open) openCount++;
        }
        uint256[] memory openIds = new uint256[](openCount);
        uint256 idx = 0;
        for (uint256 i = 1; i <= matchCount; i++) {
            if (_matches[i].state == MatchState.Open) {
                openIds[idx] = i;
                idx++;
            }
        }
        return openIds;
    }

    // === ADMIN ===

    function updateArbiter(address _newArbiter) external onlyArbiter {
        arbiter = _newArbiter;
    }

    function updateFee(uint256 _newFee) external onlyArbiter {
        require(_newFee <= 500, "Fee too high"); // Max 5%
        feePercent = _newFee;
    }

    function withdrawFees() external onlyArbiter {
        uint256 amount = totalFeesCollected;
        totalFeesCollected = 0;
        (bool sent, ) = arbiter.call{value: amount}("");
        require(sent, "Withdraw failed");
    }

    receive() external payable {}
}
