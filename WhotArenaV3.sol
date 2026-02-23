// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title WhotArenaV3
 * @notice 2-4 player wagering contract for WHOT card game on Monad
 * @dev ERC-20 token ($WHOT) wagers with escrow, multiplayer, and on-chain settlement
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract WhotArenaV3 {

    // === STRUCTS ===
    struct Match {
        uint256 id;
        uint256 maxPlayers;
        uint256 wagerPerPlayer;     // in $WHOT tokens (wei units)
        address[] players;
        address winner;
        uint256 winnerScore;
        MatchState state;
        WinCondition winCondition;
        uint256 createdAt;
        uint256 resolvedAt;
        bytes32 gameHash;
        mapping(address => uint256) scores;
    }

    enum MatchState { Open, Active, Resolved, Cancelled }
    enum WinCondition { EmptyHand, MarketExhaustion }

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
    IERC20 public whotToken;
    address public arbiter;
    uint256 public matchCount;
    uint256 public feePercent;          // basis points (100 = 1%)
    uint256 public totalFeesCollected;  // accumulated fees in $WHOT

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
    constructor(address _whotToken, uint256 _feePercent) {
        require(_whotToken != address(0), "Invalid token address");
        whotToken = IERC20(_whotToken);
        arbiter = msg.sender;
        feePercent = _feePercent;
    }

    // === MATCH LIFECYCLE ===

    /**
     * @notice Create a new match. Caller must have approved this contract for `_wagerAmount` $WHOT.
     * @param _maxPlayers 2-4 players
     * @param _wagerAmount Amount of $WHOT tokens per player
     */
    function createMatch(uint256 _maxPlayers, uint256 _wagerAmount) external returns (uint256) {
        require(_wagerAmount > 0, "Wager must be > 0");
        require(_maxPlayers >= 2 && _maxPlayers <= 4, "2-4 players only");

        // Transfer $WHOT from creator to this contract
        require(whotToken.transferFrom(msg.sender, address(this), _wagerAmount), "Token transfer failed");

        matchCount++;
        Match storage m = _matches[matchCount];
        m.id = matchCount;
        m.maxPlayers = _maxPlayers;
        m.wagerPerPlayer = _wagerAmount;
        m.players.push(msg.sender);
        m.state = MatchState.Open;
        m.createdAt = block.timestamp;

        playerMatches[msg.sender].push(matchCount);
        emit MatchCreated(matchCount, msg.sender, _maxPlayers, _wagerAmount);

        return matchCount;
    }

    /**
     * @notice Join an existing match. Caller must have approved this contract for the match wager.
     */
    function joinMatch(uint256 _matchId) external {
        Match storage m = _matches[_matchId];
        require(m.state == MatchState.Open, "Match not open");
        require(m.players.length < m.maxPlayers, "Match full");

        for (uint256 i = 0; i < m.players.length; i++) {
            require(m.players[i] != msg.sender, "Already joined");
        }

        // Transfer $WHOT from joiner to this contract
        require(whotToken.transferFrom(msg.sender, address(this), m.wagerPerPlayer), "Token transfer failed");

        m.players.push(msg.sender);
        playerMatches[msg.sender].push(_matchId);
        emit PlayerJoined(_matchId, msg.sender, m.players.length);

        if (m.players.length == m.maxPlayers) {
            m.state = MatchState.Active;
            emit MatchStarted(_matchId, m.players);
        }
    }

    /**
     * @notice Submit match result. Any match participant can settle.
     */
    function resolveMatch(
        uint256 _matchId,
        address _winner,
        WinCondition _condition,
        uint256[] calldata _playerScores,
        bytes32 _gameHash
    ) external {
        Match storage m = _matches[_matchId];
        require(m.state == MatchState.Active, "Match not active");
        require(_playerScores.length == m.players.length, "Score count mismatch");

        // Verify caller is a match participant
        bool callerInMatch = false;
        for (uint256 i = 0; i < m.players.length; i++) {
            if (m.players[i] == msg.sender) { callerInMatch = true; break; }
        }
        require(callerInMatch || msg.sender == arbiter, "Not a participant");

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

        // Calculate payout in $WHOT
        uint256 totalPot = m.wagerPerPlayer * m.players.length;
        uint256 fee = (totalPot * feePercent) / 10000;
        uint256 payout = totalPot - fee;
        totalFeesCollected += fee;

        // Update stats
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

        // Pay winner in $WHOT
        require(whotToken.transfer(_winner, payout), "Payout failed");

        emit MatchResolved(_matchId, _winner, _condition, _gameHash);
        emit Payout(_winner, payout);
    }

    /**
     * @notice Cancel an open match — refund all $WHOT wagers
     */
    function cancelMatch(uint256 _matchId) external {
        Match storage m = _matches[_matchId];
        require(m.state == MatchState.Open, "Match not open");
        require(msg.sender == m.players[0] || msg.sender == arbiter, "Not authorized");

        m.state = MatchState.Cancelled;

        for (uint256 i = 0; i < m.players.length; i++) {
            require(whotToken.transfer(m.players[i], m.wagerPerPlayer), "Refund failed");
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
        require(_newFee <= 500, "Fee too high");
        feePercent = _newFee;
    }

    function withdrawFees() external onlyArbiter {
        uint256 amount = totalFeesCollected;
        totalFeesCollected = 0;
        require(whotToken.transfer(arbiter, amount), "Withdraw failed");
    }
}
