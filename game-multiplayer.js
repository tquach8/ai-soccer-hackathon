// Multiplayer game client
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const boostFill = document.getElementById('boostFill');
const boostText = document.getElementById('boostText');
const leftTeamScoreElement = document.getElementById('leftTeamScore');
const rightTeamScoreElement = document.getElementById('rightTeamScore');
const leftTeamLabelElement = document.getElementById('leftTeamLabel');
const rightTeamLabelElement = document.getElementById('rightTeamLabel');

// Lobby elements
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const startGameBtn = document.getElementById('startGameBtn');
const backToLobbyBtn = document.getElementById('backToLobbyBtn');

// Networking
let socket = null;
let connected = false;
let currentRoomId = 'room1'; // Default room
let myPlayerId = null;
let myPlayerData = null;

// Game state (received from server)
let gameState = {
  players: [],
  ball: { x: 350, y: 200, vx: 0, vy: 0, radius: 15 },
  scores: { red: 0, blue: 0 },
  boostPads: [],
  gameState: 'lobby'
};

// Local input state
const keys = {};
let lastInputSent = {};

// Client-side prediction
let localPlayer = null;
let lastServerUpdate = 0;

// Initialize networking
function initNetwork() {
  socket = io();

  socket.on('connect', () => {
    console.log('Connected to server');
    connected = true;
    myPlayerId = socket.id;
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    connected = false;
  });

  socket.on('roomJoined', (roomState) => {
    console.log('Joined room:', roomState);
    updateLobbyFromServer(roomState);
  });

  socket.on('roomUpdate', (roomState) => {
    console.log('Room updated:', roomState);
    updateLobbyFromServer(roomState);
  });

  socket.on('gameStarted', () => {
    console.log('Game started!');
    gameState.gameState = 'playing';
    showGameScreen();
  });

  socket.on('gameState', (serverGameState) => {
    gameState = serverGameState;
    lastServerUpdate = Date.now();

    // Update local player reference for prediction
    localPlayer = gameState.players.find(p => p.id === myPlayerId);

    updateClientGameState();
  });
}

// Update lobby UI from server data
function updateLobbyFromServer(roomState) {
  // Clear all slots first
  document.querySelectorAll('.player-slot').forEach(slot => {
    slot.classList.remove('filled');
    slot.classList.add('empty');
    slot.querySelector('.slot-text').textContent = 'Click to Join';
  });

  // Fill slots with players
  roomState.players.forEach((player, index) => {
    const teamSlots = document.querySelectorAll(`[data-team="${player.team}"]`);
    if (teamSlots.length > index) {
      const slot = teamSlots[index];
      slot.classList.remove('empty');
      slot.classList.add('filled');
      slot.querySelector('.slot-text').textContent = player.name;
    }
  });

  // Update start button
  const hasPlayers = roomState.players.length > 0;
  startGameBtn.disabled = !hasPlayers;

  const lobbyInfo = document.querySelector('.lobby-info');
  if (hasPlayers) {
    lobbyInfo.textContent = `${roomState.players.length} players ready!`;
  } else {
    lobbyInfo.textContent = 'Select teams to begin playing!';
  }
}

// Show game screen
function showGameScreen() {
  lobbyScreen.style.display = 'none';
  gameScreen.style.display = 'block';

  // Start render loop
  renderLoop();
}

// Show lobby screen
function showLobbyScreen() {
  lobbyScreen.style.display = 'block';
  gameScreen.style.display = 'none';
}

// Input handling
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  keys[key] = true;

  // Prevent default browser behaviors for game keys
  if (key === ' ' || key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
    e.preventDefault();
  }

  sendInput();
});

document.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  keys[key] = false;

  // Prevent default browser behaviors for game keys
  if (key === ' ' || key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
    e.preventDefault();
  }

  sendInput();
});

// Send input to server
function sendInput() {
  if (!socket || !connected) return;

  const inputData = {
    w: keys['w'] || false,
    a: keys['a'] || false,
    s: keys['s'] || false,
    d: keys['d'] || false,
    space: keys[' '] || false,
    shift: keys['shift'] || false
  };

  // Only send if input changed
  if (JSON.stringify(inputData) !== JSON.stringify(lastInputSent)) {
    socket.emit('playerInput', { keys: inputData });
    lastInputSent = { ...inputData };
  }
}

// Update client game state
function updateClientGameState() {
  // Update scores
  leftTeamScoreElement.textContent = gameState.scores.red;
  rightTeamScoreElement.textContent = gameState.scores.blue;

  // Update boost UI for local player
  const myPlayer = gameState.players.find(p => p.id === myPlayerId);
  if (myPlayer) {
    myPlayerData = myPlayer;
    const percentage = Math.round(myPlayer.boost);
    boostFill.style.width = percentage + '%';
    boostText.textContent = percentage + '%';
  }
}

// Render game
function render() {
  // Clear canvas
  ctx.fillStyle = '#2a4a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw field lines
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);

  // Center line
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.stroke();

  // Center circle
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, 80, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([]);

  // Draw goals
  ctx.fillStyle = '#ff4444';
  ctx.fillRect(0, canvas.height / 2 - 60, 20, 120); // Left goal
  ctx.fillRect(canvas.width - 20, canvas.height / 2 - 60, 20, 120); // Right goal

  // Draw boost pads
  gameState.boostPads.forEach(pad => {
    if (pad.active) {
      // Active boost pad - glowing green
      ctx.fillStyle = '#44ff44';
      ctx.shadowColor = '#44ff44';
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Add "B" text
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('B', pad.x, pad.y + 5);
    } else {
      // Inactive boost pad - gray with cooldown
      ctx.fillStyle = '#666666';
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 20, 0, Math.PI * 2);
      ctx.fill();

      // Show cooldown progress
      const progress = 1 - (pad.cooldown / pad.maxCooldown);
      ctx.fillStyle = '#44ff44';
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 20, -Math.PI / 2, -Math.PI / 2 + (progress * Math.PI * 2));
      ctx.lineTo(pad.x, pad.y);
      ctx.fill();

      // Add faded "B" text
      ctx.fillStyle = '#333333';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('B', pad.x, pad.y + 5);
    }
  });

  // Draw ball
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(gameState.ball.x, gameState.ball.y, gameState.ball.radius, 0, Math.PI * 2);
  ctx.fill();

  // Draw ball glow if moving fast
  const ballSpeed = Math.sqrt(gameState.ball.vx ** 2 + gameState.ball.vy ** 2);
  if (ballSpeed > 5) {
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(gameState.ball.x, gameState.ball.y, gameState.ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Draw players
  gameState.players.forEach(player => {
    const isLocalPlayer = player.id === myPlayerId;
    const isKicking = isLocalPlayer && keys[' '];
    const isBoosting = isLocalPlayer && keys['shift'] && player.boost > 0;

    // Determine player color based on team
    let playerColor = player.team === 'red' ? '#ff4444' : '#4444ff';
    let shadowColor = null;
    let shadowBlur = 0;
    let strokeColor = null;
    let strokeWidth = 0;

    if (isKicking) {
      // Kicking effect - bright white highlight
      playerColor = '#ffffff';
      shadowColor = '#ff4444';
      shadowBlur = 20;
      strokeColor = '#ffff44';
      strokeWidth = 4;
    } else if (isBoosting) {
      // Boosting effect
      shadowColor = player.team === 'red' ? '#ff4444' : '#4444ff';
      shadowBlur = 15;
    }

    // Apply shadow if needed
    if (shadowColor) {
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
    }

    // Draw player circle
    ctx.fillStyle = playerColor;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Draw stroke if kicking
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 20, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Reset shadow
    ctx.shadowBlur = 0;

    // Draw player name
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, player.x, player.y - 30);

    // Draw direction indicator for local player
    if (isLocalPlayer) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const lookX = player.x + Math.cos(Math.atan2(gameState.ball.y - player.y, gameState.ball.x - player.x)) * 25;
      const lookY = player.y + Math.sin(Math.atan2(gameState.ball.y - player.y, gameState.ball.x - player.x)) * 25;
      ctx.moveTo(player.x, player.y);
      ctx.lineTo(lookX, lookY);
      ctx.stroke();
    }
  });
}

// Client-side prediction for smooth movement
function predictLocalPlayer() {
  if (!localPlayer || !connected) return;

  // Predict local player movement for smooth controls
  const deltaTime = 16; // Assume 60fps
  let speed = 1.5; // PLAYER_SPEED

  if (keys['shift'] && localPlayer.boost > 0) {
    speed = 2.2; // BOOST_SPEED
  }

  // Movement prediction
  let dx = 0, dy = 0;
  if (keys['a']) dx -= 1;
  if (keys['d']) dx += 1;
  if (keys['w']) dy -= 1;
  if (keys['s']) dy += 1;

  // Normalize diagonal movement
  if (dx !== 0 && dy !== 0) {
    dx *= 0.707;
    dy *= 0.707;
  }

  // Apply predicted movement
  localPlayer.x += dx * speed;
  localPlayer.y += dy * speed;

  // Keep in bounds
  const outOfBoundsBuffer = 20 * 0.6;
  localPlayer.x = Math.min(Math.max(localPlayer.x, -outOfBoundsBuffer), 700 + outOfBoundsBuffer);
  localPlayer.y = Math.min(Math.max(localPlayer.y, -outOfBoundsBuffer), 400 + outOfBoundsBuffer);
}

// Render loop
function renderLoop() {
  if (gameState.gameState === 'playing') {
    predictLocalPlayer(); // Predict movement for smooth controls
  }

  render();

  if (gameState.gameState === 'playing') {
    requestAnimationFrame(renderLoop);
  }
}

// Lobby functions
function initializeLobby() {
  // Add click listeners to player slots
  document.querySelectorAll('.player-slot').forEach(slot => {
    slot.addEventListener('click', handleSlotClick);
  });

  // Add button listeners
  startGameBtn.addEventListener('click', startGame);
  backToLobbyBtn.addEventListener('click', backToLobby);
}

function handleSlotClick(event) {
  if (!connected) {
    alert('Not connected to server!');
    return;
  }

  const slot = event.currentTarget;
  const team = slot.dataset.team;

  if (slot.classList.contains('empty')) {
    // Join this team
    const playerName = prompt('Enter your name:') || `Player ${Date.now()}`;

    const playerData = {
      name: playerName,
      team: team
    };

    socket.emit('joinRoom', {
      roomId: currentRoomId,
      playerData: playerData
    });
  }
}

function startGame() {
  if (!connected) {
    alert('Not connected to server!');
    return;
  }

  socket.emit('startGame');
}

function backToLobby() {
  showLobbyScreen();
  // Could emit 'leaveGame' to server if needed
}

// Initialize everything
function init() {
  console.log('Boost Arena Multiplayer starting...');

  initNetwork();
  initializeLobby();

  // Show lobby screen initially
  showLobbyScreen();
}

// Start the initialization when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
} 