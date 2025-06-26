const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const {
  initializeDatabase,
  registerUser,
  loginUser,
  verifyToken,
  getUserStats,
  updateUserStats,
  updateUserStatsByUsername,
  getLeaderboard
} = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname)));

// Authentication routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be between 3 and 20 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const result = await registerUser(username, password);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json(error);
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await loginUser(username, password);
    res.json(result);
  } catch (error) {
    res.status(401).json(error);
  }
});

app.get('/api/stats/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const stats = await getUserStats(userId);
    res.json(stats);
  } catch (error) {
    res.status(404).json(error);
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const leaderboard = await getLeaderboard(limit);
    res.json(leaderboard);
  } catch (error) {
    res.status(500).json(error);
  }
});

// Auth middleware for protected routes
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      throw new Error();
    }
    const decoded = await verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const stats = await getUserStats(req.user.id);
    res.json({ ...req.user, ...stats });
  } catch (error) {
    res.status(500).json(error);
  }
});

// Game constants (match client-side)
const GAME_CONFIG = {
  // Base dimensions for 1-4 players
  BASE_CANVAS_WIDTH: 700,
  BASE_CANVAS_HEIGHT: 400,
  // Medium dimensions for 5-6 players  
  MEDIUM_CANVAS_WIDTH: 900,
  MEDIUM_CANVAS_HEIGHT: 500,
  // Large dimensions for 7-8 players
  LARGE_CANVAS_WIDTH: 1100,
  LARGE_CANVAS_HEIGHT: 600,

  PLAYER_SPEED: 1.5,
  BOOST_SPEED: 2.7,
  BALL_FRICTION: 0.995,
  WALL_BOUNCE: 0.3,
  HIT_FORCE: 0.8,
  BOOST_HIT_MULTIPLIER: 1.3,
  BOOST_DRAIN_RATE: 1,
  BOOST_REGEN_RATE: 0.05,
  TICK_RATE: 120,
  MAX_PLAYERS: 8
};

// Helper function to get map dimensions based on player count
function getMapDimensions(playerCount) {
  if (playerCount <= 4) {
    return { width: GAME_CONFIG.BASE_CANVAS_WIDTH, height: GAME_CONFIG.BASE_CANVAS_HEIGHT };
  } else if (playerCount <= 6) {
    return { width: GAME_CONFIG.MEDIUM_CANVAS_WIDTH, height: GAME_CONFIG.MEDIUM_CANVAS_HEIGHT };
  } else {
    return { width: GAME_CONFIG.LARGE_CANVAS_WIDTH, height: GAME_CONFIG.LARGE_CANVAS_HEIGHT };
  }
}

// Game state
const gameRooms = new Map();

class GameRoom {
  constructor(roomId, ownerId) {
    this.id = roomId;
    this.ownerId = ownerId; // First person to join becomes owner
    this.players = new Map();
    this.gameState = 'lobby'; // 'lobby', 'playing', 'finished'
    this.scores = { red: 0, blue: 0 };
    this.playerGoals = new Map(); // Track individual player goals
    this.gameLoop = null;

    // Kickoff system
    this.kickoffActive = false;
    this.kickoffTeam = null; // 'red' or 'blue' - team that gets to kick off

    // Ball - will be positioned dynamically based on map size
    this.ball = {
      x: 0, // Will be set when game starts
      y: 0, // Will be set when game starts
      vx: 0,
      vy: 0,
      radius: 10,
      lastTouchedBy: null // Track who last touched the ball
    };

    // Boost pads - will be generated dynamically based on map size
    this.boostPads = [];

    this.lastUpdate = Date.now();
  }

  // Generate boost pads based on current map dimensions
  generateBoostPads() {
    const dimensions = getMapDimensions(this.players.size);
    const { width, height } = dimensions;

    this.boostPads = [
      // Corner boost pads
      { x: 80, y: 80, active: true, cooldown: 0, maxCooldown: 180 },
      { x: width - 80, y: 80, active: true, cooldown: 0, maxCooldown: 180 },
      { x: 80, y: height - 80, active: true, cooldown: 0, maxCooldown: 180 },
      { x: width - 80, y: height - 80, active: true, cooldown: 0, maxCooldown: 180 }
    ];
  }

  addPlayer(socketId, playerData) {
    const dimensions = getMapDimensions(this.players.size + 1); // +1 for the player being added

    this.players.set(socketId, {
      id: socketId,
      name: playerData.name,
      team: playerData.team,
      x: 100,
      y: dimensions.height / 2,
      boost: 100,
      keys: {},
      lastUpdate: Date.now()
    });

    // Regenerate boost pads for new player count
    this.generateBoostPads();

    return this.players.get(socketId);
  }

  removePlayer(socketId) {
    this.players.delete(socketId);

    // Transfer ownership if owner left
    if (this.ownerId === socketId && this.players.size > 0) {
      this.ownerId = Array.from(this.players.keys())[0];
      console.log(`Owner left room ${this.id}, transferring ownership to ${this.ownerId}`);
    }

    // Regenerate boost pads for new player count
    if (this.players.size > 0) {
      this.generateBoostPads();
    }

    if (this.players.size === 0) {
      this.stopGameLoop();
    }
  }

  updatePlayerInput(socketId, keys) {
    const player = this.players.get(socketId);
    if (player) {
      player.keys = keys;
      player.lastUpdate = Date.now();
    }
  }

  startGame() {
    this.gameState = 'playing';
    this.scores = { red: 0, blue: 0 };
    this.playerGoals.clear(); // Reset individual player goal counts

    // Initialize goal counts for all players
    this.players.forEach((player, playerId) => {
      this.playerGoals.set(playerId, 0);
    });

    // Set initial kickoff for red team
    this.kickoffActive = true;
    this.kickoffTeam = 'red';

    // Generate boost pads and reset positions for current player count
    this.generateBoostPads();
    this.resetBall();
    this.resetPlayers();
    this.startGameLoop();

    // Immediately broadcast initial game state
    this.broadcastGameState();
  }

  resetBall() {
    const dimensions = getMapDimensions(this.players.size);
    this.ball.x = dimensions.width / 2;
    this.ball.y = dimensions.height / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.lastTouchedBy = null; // Clear last touched
  }

  resetPlayers() {
    const dimensions = getMapDimensions(this.players.size);

    // Group players by team
    const redPlayers = Array.from(this.players.values()).filter(p => p.team === 'red');
    const bluePlayers = Array.from(this.players.values()).filter(p => p.team === 'blue');

    // Reset red team positions (left side)
    redPlayers.forEach((player, index) => {
      player.x = 100;
      if (redPlayers.length === 1) {
        player.y = dimensions.height / 2; // Center if only one player
      } else {
        // Stagger Y positions if multiple players
        const spacing = Math.min(80, (dimensions.height - 160) / (redPlayers.length - 1)); // Adaptive spacing
        const startY = dimensions.height / 2 - ((redPlayers.length - 1) * spacing / 2);
        player.y = startY + (index * spacing);
      }
      player.boost = 100;
    });

    // Reset blue team positions (right side)
    bluePlayers.forEach((player, index) => {
      player.x = dimensions.width - 100;
      if (bluePlayers.length === 1) {
        player.y = dimensions.height / 2; // Center if only one player
      } else {
        // Stagger Y positions if multiple players
        const spacing = Math.min(80, (dimensions.height - 160) / (bluePlayers.length - 1)); // Adaptive spacing
        const startY = dimensions.height / 2 - ((bluePlayers.length - 1) * spacing / 2);
        player.y = startY + (index * spacing);
      }
      player.boost = 100;
    });
  }

  update() {
    if (this.gameState !== 'playing') return;

    const deltaTime = 1000 / GAME_CONFIG.TICK_RATE;

    // Update players
    this.players.forEach(player => {
      this.updatePlayer(player, deltaTime);
    });

    // Update ball
    this.updateBall(deltaTime);

    // Update boost pads
    this.updateBoostPads();

    // Check goals
    this.checkGoals();
  }

  updatePlayer(player, deltaTime) {
    const dimensions = getMapDimensions(this.players.size);

    let speed = GAME_CONFIG.PLAYER_SPEED;
    let isBoosting = player.keys.shift && player.boost > 0;

    // Handle boost
    if (isBoosting) {
      speed = GAME_CONFIG.BOOST_SPEED;
      player.boost = Math.max(0, player.boost - GAME_CONFIG.BOOST_DRAIN_RATE);
    } else {
      player.boost = Math.min(100, player.boost + GAME_CONFIG.BOOST_REGEN_RATE);
    }

    // Movement
    let dx = 0, dy = 0;
    if (player.keys.a) dx -= 1;
    if (player.keys.d) dx += 1;
    if (player.keys.w) dy -= 1;
    if (player.keys.s) dy += 1;

    // Normalize diagonal movement
    if (dx !== 0 && dy !== 0) {
      dx *= 0.707;
      dy *= 0.707;
    }

    // Apply movement
    player.x += dx * speed;
    player.y += dy * speed;

    // Check player-to-player collisions
    this.handlePlayerCollisions(player);

    // Center line restriction during kickoff
    if (this.kickoffActive) {
      const centerLine = dimensions.width / 2;
      const centerX = dimensions.width / 2;
      const centerY = dimensions.height / 2;
      const centerCircleRadius = 80;

      // Calculate distance from player to center circle
      const distanceToCenter = Math.sqrt((player.x - centerX) ** 2 + (player.y - centerY) ** 2);

      // Prevent scoring team from crossing center line OR entering center circle
      if (this.kickoffTeam === 'red' && player.team === 'blue') {
        // Blue team scored, so they can't cross to the left side OR enter center circle
        player.x = Math.max(player.x, centerLine);

        // Also prevent them from entering the center circle
        if (distanceToCenter < centerCircleRadius + 20) { // 20 is player radius
          const angle = Math.atan2(player.y - centerY, player.x - centerX);
          player.x = centerX + Math.cos(angle) * (centerCircleRadius + 20);
          player.y = centerY + Math.sin(angle) * (centerCircleRadius + 20);
        }
      } else if (this.kickoffTeam === 'blue' && player.team === 'red') {
        // Red team scored, so they can't cross to the right side OR enter center circle
        player.x = Math.min(player.x, centerLine);

        // Also prevent them from entering the center circle
        if (distanceToCenter < centerCircleRadius + 20) { // 20 is player radius
          const angle = Math.atan2(player.y - centerY, player.x - centerX);
          player.x = centerX + Math.cos(angle) * (centerCircleRadius + 20);
          player.y = centerY + Math.sin(angle) * (centerCircleRadius + 20);
        }
      }
    }

    // Keep player mostly in bounds
    const outOfBoundsBuffer = 20 * 0.6;
    player.x = this.clamp(player.x, -outOfBoundsBuffer, dimensions.width + outOfBoundsBuffer);
    player.y = this.clamp(player.y, -outOfBoundsBuffer, dimensions.height + outOfBoundsBuffer);

    // Ball hitting
    if (player.keys.space) {
      this.hitBall(player, isBoosting);
    }

    // Check boost pad collisions
    this.checkBoostPadCollisions(player);
  }

  handlePlayerCollisions(currentPlayer) {
    const playerRadius = 20;
    const minDistance = playerRadius * 2; // Two player radii

    // Check collision with all other players
    this.players.forEach(otherPlayer => {
      // Skip checking against self
      if (otherPlayer.id === currentPlayer.id) return;

      const dist = this.distance(currentPlayer, otherPlayer);

      if (dist < minDistance && dist > 0) {
        // Calculate overlap
        const overlap = minDistance - dist;
        const angle = Math.atan2(otherPlayer.y - currentPlayer.y, otherPlayer.x - currentPlayer.x);

        // Separate players by half the overlap each
        const separateX = Math.cos(angle) * overlap * 0.5;
        const separateY = Math.sin(angle) * overlap * 0.5;

        // Move current player away from other player
        currentPlayer.x -= separateX;
        currentPlayer.y -= separateY;

        // Move other player away from current player
        otherPlayer.x += separateX;
        otherPlayer.y += separateY;
      }
    });
  }

  updateBall(deltaTime) {
    const dimensions = getMapDimensions(this.players.size);

    // Handle player-ball collisions
    this.players.forEach(player => {
      this.handlePlayerBallCollision(player);
    });

    // Apply velocity
    this.ball.x += this.ball.vx;
    this.ball.y += this.ball.vy;

    // Apply friction
    this.ball.vx *= GAME_CONFIG.BALL_FRICTION;
    this.ball.vy *= GAME_CONFIG.BALL_FRICTION;

    // Wall collisions
    if (this.ball.x - this.ball.radius <= 0 || this.ball.x + this.ball.radius >= dimensions.width) {
      this.ball.vx *= -GAME_CONFIG.WALL_BOUNCE;
      this.ball.x = this.clamp(this.ball.x, this.ball.radius, dimensions.width - this.ball.radius);
    }

    if (this.ball.y - this.ball.radius <= 0 || this.ball.y + this.ball.radius >= dimensions.height) {
      this.ball.vy *= -GAME_CONFIG.WALL_BOUNCE;
      this.ball.y = this.clamp(this.ball.y, this.ball.radius, dimensions.height - this.ball.radius);
    }
  }

  handlePlayerBallCollision(player) {
    const dist = this.distance(player, this.ball);
    const minDistance = 20 + this.ball.radius;

    if (dist < minDistance) {
      // Track who touched the ball
      this.ball.lastTouchedBy = player.id;

      // End kickoff if the kickoff team touches the ball
      if (this.kickoffActive && player.team === this.kickoffTeam) {
        this.kickoffActive = false;
        this.kickoffTeam = null;
      }

      const angle = Math.atan2(this.ball.y - player.y, this.ball.x - player.x);

      // Separate objects
      const overlap = minDistance - dist;
      const separateX = Math.cos(angle) * overlap * 0.5;
      const separateY = Math.sin(angle) * overlap * 0.5;

      this.ball.x += separateX;
      this.ball.y += separateY;
      player.x -= separateX;
      player.y -= separateY;

      // Minimal push force
      let pushForce = 0.02;
      if (player.keys.shift && player.boost > 0) {
        pushForce = 0.05;
      }

      let playerVx = 0, playerVy = 0;
      if (player.keys.a) playerVx -= 1;
      if (player.keys.d) playerVx += 1;
      if (player.keys.w) playerVy -= 1;
      if (player.keys.s) playerVy += 1;

      this.ball.vx += Math.cos(angle) * pushForce + playerVx * 0.02;
      this.ball.vy += Math.sin(angle) * pushForce + playerVy * 0.02;
    }
  }

  hitBall(player, boosted) {
    const dist = this.distance(player, this.ball);
    const hitRange = 20 + this.ball.radius + 10;

    if (dist < hitRange) {
      // Track who hit the ball
      this.ball.lastTouchedBy = player.id;

      // End kickoff if the kickoff team touches the ball
      if (this.kickoffActive && player.team === this.kickoffTeam) {
        this.kickoffActive = false;
        this.kickoffTeam = null;
      }

      const angle = Math.atan2(this.ball.y - player.y, this.ball.x - player.x);
      let force = GAME_CONFIG.HIT_FORCE;

      if (boosted && player.boost > 15) {
        force *= GAME_CONFIG.BOOST_HIT_MULTIPLIER;
        player.boost -= 15;
      }

      this.ball.vx += Math.cos(angle) * force;
      this.ball.vy += Math.sin(angle) * force;

      // Add randomness
      this.ball.vx += (Math.random() - 0.5) * 2;
      this.ball.vy += (Math.random() - 0.5) * 2;
    }
  }

  checkBoostPadCollisions(player) {
    this.boostPads.forEach(pad => {
      if (pad.active) {
        const dist = this.distance(player, pad);
        if (dist < 20 + 20) {
          player.boost = Math.min(100, player.boost + 25);
          pad.active = false;
          pad.cooldown = pad.maxCooldown;
        }
      }
    });
  }

  updateBoostPads() {
    this.boostPads.forEach(pad => {
      if (!pad.active) {
        pad.cooldown--;
        if (pad.cooldown <= 0) {
          pad.active = true;
        }
      }
    });
  }

  checkGoals() {
    const dimensions = getMapDimensions(this.players.size);
    const goalHeight = Math.min(120, dimensions.height * 0.3); // Goal height scales with map size
    const goalWidth = 20;

    const goals = {
      left: { x: 0, y: dimensions.height / 2 - goalHeight / 2, width: goalWidth, height: goalHeight },
      right: { x: dimensions.width - goalWidth, y: dimensions.height / 2 - goalHeight / 2, width: goalWidth, height: goalHeight }
    };

    let goalScored = false;
    let scoringTeam = null;

    // Left goal (blue team scores)
    if (this.ball.x <= goals.left.x + goals.left.width &&
      this.ball.y >= goals.left.y &&
      this.ball.y <= goals.left.y + goals.left.height) {
      this.scores.blue++;
      goalScored = true;
      scoringTeam = 'blue';

      // Track individual goal if someone touched the ball
      if (this.ball.lastTouchedBy && this.players.has(this.ball.lastTouchedBy)) {
        const scorer = this.players.get(this.ball.lastTouchedBy);
        if (scorer.team === 'blue') {
          this.playerGoals.set(this.ball.lastTouchedBy, (this.playerGoals.get(this.ball.lastTouchedBy) || 0) + 1);
        }
      }

      // Set kickoff for red team (they didn't score)
      this.kickoffActive = true;
      this.kickoffTeam = 'red';
    }

    // Right goal (red team scores)
    if (this.ball.x >= goals.right.x &&
      this.ball.y >= goals.right.y &&
      this.ball.y <= goals.right.y + goals.right.height) {
      this.scores.red++;
      goalScored = true;
      scoringTeam = 'red';

      // Track individual goal if someone touched the ball
      if (this.ball.lastTouchedBy && this.players.has(this.ball.lastTouchedBy)) {
        const scorer = this.players.get(this.ball.lastTouchedBy);
        if (scorer.team === 'red') {
          this.playerGoals.set(this.ball.lastTouchedBy, (this.playerGoals.get(this.ball.lastTouchedBy) || 0) + 1);
        }
      }

      // Set kickoff for blue team (they didn't score)
      this.kickoffActive = true;
      this.kickoffTeam = 'blue';
    }

    if (goalScored) {
      // Check for win condition (first to 3 goals)
      if (this.scores.red >= 3 || this.scores.blue >= 3) {
        this.endGame(scoringTeam);
      } else {
        this.resetBall();
        this.resetPlayers();
      }
    }
  }

  async endGame(winningTeam) {
    this.gameState = 'finished';
    this.stopGameLoop();

    // Prepare game results
    const gameResults = {
      winningTeam: winningTeam,
      finalScores: { ...this.scores },
      playerStats: this.getPlayerStats()
    };

    // Update user statistics in database
    await this.updatePlayerStatsInDatabase(winningTeam);

    // Broadcast game end
    io.to(this.id).emit('gameEnded', gameResults);
  }

  async updatePlayerStatsInDatabase(winningTeam) {
    // Get all authenticated players (those with usernames that exist in database)
    const authenticatedPlayers = Array.from(this.players.values()).filter(player =>
      player.name && player.team && (player.team === 'red' || player.team === 'blue')
    );

    // Update stats for each authenticated player
    for (const player of authenticatedPlayers) {
      try {
        const won = player.team === winningTeam;
        const goals = this.playerGoals.get(player.id) || 0;

        // Only update if this appears to be a registered user (has a proper username)
        if (player.name && player.name !== 'Player' && player.name.length >= 3) {
          await updateUserStatsByUsername(player.name, won, goals);
        }
      } catch (error) {
        console.error(`Failed to update stats for player ${player.name}:`, error);
      }
    }
  }

  returnToLobby() {
    this.gameState = 'lobby';
    this.scores = { red: 0, blue: 0 };
    this.playerGoals.clear();
    this.kickoffActive = false;
    this.kickoffTeam = null;
    this.stopGameLoop();

    // Reset ball position but don't start game loop
    this.resetBall();

    // Reset player positions to default lobby positions
    this.players.forEach(player => {
      const dimensions = getMapDimensions(this.players.size);
      player.x = 100;
      player.y = dimensions.height / 2;
      player.boost = 100;
      player.keys = {};
    });

    // Broadcast return to lobby
    const roomState = this.getState();
    io.to(this.id).emit('roomUpdate', roomState);
  }

  getPlayerStats() {
    const stats = {
      red: [],
      blue: []
    };

    this.players.forEach((player, playerId) => {
      const playerStat = {
        id: playerId,
        name: player.name,
        goals: this.playerGoals.get(playerId) || 0
      };

      if (player.team === 'red') {
        stats.red.push(playerStat);
      } else if (player.team === 'blue') {
        stats.blue.push(playerStat);
      }
    });

    // Sort by goals descending
    stats.red.sort((a, b) => b.goals - a.goals);
    stats.blue.sort((a, b) => b.goals - a.goals);

    return stats;
  }

  startGameLoop() {
    if (this.gameLoop) return;

    this.gameLoop = setInterval(() => {
      this.update();
      this.broadcastGameState();
    }, 1000 / GAME_CONFIG.TICK_RATE);
  }

  stopGameLoop() {
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
      this.gameLoop = null;
    }
  }

  broadcastGameState() {
    const dimensions = getMapDimensions(this.players.size);
    const goalHeight = Math.min(120, dimensions.height * 0.3);

    const gameState = {
      players: Array.from(this.players.values()),
      ball: this.ball,
      scores: this.scores,
      boostPads: this.boostPads,
      gameState: this.gameState,
      kickoffActive: this.kickoffActive,
      kickoffTeam: this.kickoffTeam,
      mapDimensions: dimensions,
      goalHeight: goalHeight
    };

    io.to(this.id).emit('gameState', gameState);
  }

  getState() {
    return {
      id: this.id,
      ownerId: this.ownerId,
      players: Array.from(this.players.values()),
      gameState: this.gameState,
      scores: this.scores
    };
  }

  // Utility functions
  distance(obj1, obj2) {
    return Math.sqrt((obj1.x - obj2.x) ** 2 + (obj1.y - obj2.y) ** 2);
  }

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  canPlayerJoin() {
    return this.players.size < GAME_CONFIG.MAX_PLAYERS;
  }
}

// Broadcast lobby list to all clients
function broadcastLobbyList() {
  const lobbies = Array.from(gameRooms.values()).map(room => ({
    id: room.id,
    playerCount: room.players.size,
    gameState: room.gameState,
    ownerId: room.ownerId
  }));

  console.log('Broadcasting lobby list:', lobbies);
  io.emit('lobbyListUpdate', lobbies);
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('joinRoom', (data) => {
    const { roomId, playerData } = data;

    // Get or create room
    if (!gameRooms.has(roomId)) {
      gameRooms.set(roomId, new GameRoom(roomId, socket.id)); // Owner is the first person to join
    }

    const room = gameRooms.get(roomId);

    // Make sure socket joins room first
    socket.join(roomId);

    // Add player to room (no team initially)
    const player = room.addPlayer(socket.id, playerData);

    // Send room state to joining player
    socket.emit('roomJoined', room.getState());

    // Small delay to ensure socket is fully joined, then broadcast to all
    setTimeout(() => {
      const roomState = room.getState();
      console.log(`Broadcasting room update to ${roomId}:`, roomState);
      io.to(roomId).emit('roomUpdate', roomState);
    }, 10);

    console.log(`Player ${playerData.name} joined room ${roomId}`);

    // Broadcast updated lobby list to all clients
    broadcastLobbyList();
  });

  socket.on('joinTeam', (data) => {
    const { roomId, team } = data;

    // Find player's room
    let playerRoom = null;
    for (const room of gameRooms.values()) {
      if (room.players.has(socket.id)) {
        playerRoom = room;
        break;
      }
    }

    if (playerRoom) {
      const player = playerRoom.players.get(socket.id);
      if (player) {
        player.team = team;
        console.log(`Player ${player.name} joined team ${team} in room ${roomId}`);

        // Broadcast updated room state
        const roomState = playerRoom.getState();
        io.to(roomId).emit('roomUpdate', roomState);

        // Also broadcast updated lobby list
        broadcastLobbyList();
      }
    }
  });

  socket.on('leaveRoom', (data) => {
    const { roomId } = data;

    // Find and remove player from room
    let playerRoom = null;
    for (const room of gameRooms.values()) {
      if (room.players.has(socket.id)) {
        playerRoom = room;
        break;
      }
    }

    if (playerRoom) {
      const player = playerRoom.players.get(socket.id);
      console.log(`Player ${player?.name || socket.id} left room ${roomId}`);

      playerRoom.removePlayer(socket.id);
      socket.leave(roomId);

      // Broadcast updated room state if room still has players
      if (playerRoom.players.size > 0) {
        const roomState = playerRoom.getState();
        io.to(roomId).emit('roomUpdate', roomState);
      } else {
        // Remove empty room
        gameRooms.delete(roomId);
      }

      // Broadcast updated lobby list
      broadcastLobbyList();
    }
  });

  socket.on('requestLobbyList', () => {
    const lobbies = Array.from(gameRooms.values()).map(room => ({
      id: room.id,
      playerCount: room.players.size,
      gameState: room.gameState,
      ownerId: room.ownerId
    }));

    socket.emit('lobbyListUpdate', lobbies);
  });

  socket.on('playerInput', (data) => {
    // Find player's room
    let playerRoom = null;
    for (const room of gameRooms.values()) {
      if (room.players.has(socket.id)) {
        playerRoom = room;
        break;
      }
    }

    if (playerRoom) {
      playerRoom.updatePlayerInput(socket.id, data.keys);
    }
  });

  socket.on('startGame', () => {
    // Find player's room and start game
    let playerRoom = null;
    for (const room of gameRooms.values()) {
      if (room.players.has(socket.id)) {
        playerRoom = room;
        break;
      }
    }

    if (playerRoom) {
      // Only allow the room owner to start the game
      if (playerRoom.ownerId === socket.id) {
        playerRoom.startGame();
        io.to(playerRoom.id).emit('gameStarted');
        console.log(`Game started in room ${playerRoom.id} by owner ${socket.id}`);
      } else {
        socket.emit('error', { message: 'Only the room owner can start the game' });
        console.log(`Player ${socket.id} tried to start game but is not owner of room ${playerRoom.id}`);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    // Remove player from all rooms
    for (const room of gameRooms.values()) {
      if (room.players.has(socket.id)) {
        room.removePlayer(socket.id);

        // Broadcast updated room state
        if (room.players.size > 0) {
          io.to(room.id).emit('roomUpdate', room.getState());
        } else {
          // Remove empty room
          gameRooms.delete(room.id);
        }

        // Broadcast updated lobby list
        broadcastLobbyList();
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabase();
    server.listen(PORT, () => {
      console.log(`🚀 Blitz Ball multiplayer server running on port ${PORT}`);
      console.log(`🌐 Access the game at: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

startServer();