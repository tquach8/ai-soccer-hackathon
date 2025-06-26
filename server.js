const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Game constants (match client-side)
const GAME_CONFIG = {
  CANVAS_WIDTH: 700,
  CANVAS_HEIGHT: 400,
  PLAYER_SPEED: 1.5,
  BOOST_SPEED: 2.7,
  BALL_FRICTION: 0.995,
  WALL_BOUNCE: 0.3,
  HIT_FORCE: 0.8,
  BOOST_HIT_MULTIPLIER: 1.3,
  BOOST_DRAIN_RATE: 1,
  BOOST_REGEN_RATE: 0.05,
  TICK_RATE: 120
};

// Game state
const gameRooms = new Map();

class GameRoom {
  constructor(roomId, ownerId) {
    this.id = roomId;
    this.ownerId = ownerId; // First person to join becomes owner
    this.players = new Map();
    this.gameState = 'lobby'; // 'lobby', 'playing'
    this.scores = { red: 0, blue: 0 };
    this.gameLoop = null;

    // Kickoff system
    this.kickoffActive = false;
    this.kickoffTeam = null; // 'red' or 'blue' - team that gets to kick off

    // Ball
    this.ball = {
      x: GAME_CONFIG.CANVAS_WIDTH / 2,
      y: GAME_CONFIG.CANVAS_HEIGHT / 2,
      vx: 0,
      vy: 0,
      radius: 10
    };

    // Boost pads
    this.boostPads = [
      { x: 50, y: 50, active: true, cooldown: 0, maxCooldown: 180 },
      { x: GAME_CONFIG.CANVAS_WIDTH - 50, y: 50, active: true, cooldown: 0, maxCooldown: 180 },
      { x: 50, y: GAME_CONFIG.CANVAS_HEIGHT - 50, active: true, cooldown: 0, maxCooldown: 180 },
      { x: GAME_CONFIG.CANVAS_WIDTH - 50, y: GAME_CONFIG.CANVAS_HEIGHT - 50, active: true, cooldown: 0, maxCooldown: 180 }
    ];

    this.lastUpdate = Date.now();
  }

  addPlayer(socketId, playerData) {
    const player = {
      id: socketId,
      name: playerData.name,
      team: playerData.team || null, // Allow no team initially
      x: 100, // Default position, will be updated when team is selected
      y: GAME_CONFIG.CANVAS_HEIGHT / 2,
      boost: 100,
      keys: {},
      lastUpdate: Date.now()
    };

    this.players.set(socketId, player);
    return player;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);

    // If the owner left, transfer ownership to another player
    if (this.ownerId === socketId && this.players.size > 0) {
      this.ownerId = Array.from(this.players.keys())[0];
      console.log(`Owner left room ${this.id}, transferring ownership to ${this.ownerId}`);
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

    // Set initial kickoff for red team
    this.kickoffActive = true;
    this.kickoffTeam = 'red';

    this.resetBall();
    this.resetPlayers();
    this.startGameLoop();

    // Immediately broadcast initial game state
    this.broadcastGameState();
  }

  resetBall() {
    this.ball.x = GAME_CONFIG.CANVAS_WIDTH / 2;
    this.ball.y = GAME_CONFIG.CANVAS_HEIGHT / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
  }

  resetPlayers() {
    // Group players by team
    const redPlayers = Array.from(this.players.values()).filter(p => p.team === 'red');
    const bluePlayers = Array.from(this.players.values()).filter(p => p.team === 'blue');

    // Reset red team positions
    redPlayers.forEach((player, index) => {
      player.x = 100;
      if (redPlayers.length === 1) {
        player.y = GAME_CONFIG.CANVAS_HEIGHT / 2; // Center if only one player
      } else {
        // Stagger Y positions if multiple players
        const spacing = 80; // Vertical spacing between players
        const startY = GAME_CONFIG.CANVAS_HEIGHT / 2 - ((redPlayers.length - 1) * spacing / 2);
        player.y = startY + (index * spacing);
      }
      player.boost = 100;
    });

    // Reset blue team positions
    bluePlayers.forEach((player, index) => {
      player.x = GAME_CONFIG.CANVAS_WIDTH - 100;
      if (bluePlayers.length === 1) {
        player.y = GAME_CONFIG.CANVAS_HEIGHT / 2; // Center if only one player
      } else {
        // Stagger Y positions if multiple players
        const spacing = 80; // Vertical spacing between players
        const startY = GAME_CONFIG.CANVAS_HEIGHT / 2 - ((bluePlayers.length - 1) * spacing / 2);
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

    // Center line restriction during kickoff
    if (this.kickoffActive) {
      const centerLine = GAME_CONFIG.CANVAS_WIDTH / 2;
      const centerX = GAME_CONFIG.CANVAS_WIDTH / 2;
      const centerY = GAME_CONFIG.CANVAS_HEIGHT / 2;
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
    player.x = this.clamp(player.x, -outOfBoundsBuffer, GAME_CONFIG.CANVAS_WIDTH + outOfBoundsBuffer);
    player.y = this.clamp(player.y, -outOfBoundsBuffer, GAME_CONFIG.CANVAS_HEIGHT + outOfBoundsBuffer);

    // Ball hitting
    if (player.keys.space) {
      this.hitBall(player, isBoosting);
    }

    // Check boost pad collisions
    this.checkBoostPadCollisions(player);
  }

  updateBall(deltaTime) {
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
    if (this.ball.x - this.ball.radius <= 0 || this.ball.x + this.ball.radius >= GAME_CONFIG.CANVAS_WIDTH) {
      this.ball.vx *= -GAME_CONFIG.WALL_BOUNCE;
      this.ball.x = this.clamp(this.ball.x, this.ball.radius, GAME_CONFIG.CANVAS_WIDTH - this.ball.radius);
    }

    if (this.ball.y - this.ball.radius <= 0 || this.ball.y + this.ball.radius >= GAME_CONFIG.CANVAS_HEIGHT) {
      this.ball.vy *= -GAME_CONFIG.WALL_BOUNCE;
      this.ball.y = this.clamp(this.ball.y, this.ball.radius, GAME_CONFIG.CANVAS_HEIGHT - this.ball.radius);
    }
  }

  handlePlayerBallCollision(player) {
    const dist = this.distance(player, this.ball);
    const minDistance = 20 + this.ball.radius;

    if (dist < minDistance) {
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
    const goals = {
      left: { x: 0, y: GAME_CONFIG.CANVAS_HEIGHT / 2 - 60, width: 20, height: 120 },
      right: { x: GAME_CONFIG.CANVAS_WIDTH - 20, y: GAME_CONFIG.CANVAS_HEIGHT / 2 - 60, width: 20, height: 120 }
    };

    // Left goal (blue team scores)
    if (this.ball.x <= goals.left.x + goals.left.width &&
      this.ball.y >= goals.left.y &&
      this.ball.y <= goals.left.y + goals.left.height) {
      this.scores.blue++;

      // Set kickoff for red team (they didn't score)
      this.kickoffActive = true;
      this.kickoffTeam = 'red';

      this.resetBall();
      this.resetPlayers();
    }

    // Right goal (red team scores)
    if (this.ball.x >= goals.right.x &&
      this.ball.y >= goals.right.y &&
      this.ball.y <= goals.right.y + goals.right.height) {
      this.scores.red++;

      // Set kickoff for blue team (they didn't score)
      this.kickoffActive = true;
      this.kickoffTeam = 'blue';

      this.resetBall();
      this.resetPlayers();
    }
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
    const gameState = {
      players: Array.from(this.players.values()),
      ball: this.ball,
      scores: this.scores,
      boostPads: this.boostPads,
      gameState: this.gameState,
      kickoffActive: this.kickoffActive,
      kickoffTeam: this.kickoffTeam
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
server.listen(PORT, () => {
  console.log(`🚀 Boost Arena multiplayer server running on port ${PORT}`);
  console.log(`🌐 Access the game at: http://localhost:${PORT}`);
}); 