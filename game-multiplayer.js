// Multiplayer game client
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const boostFill = document.getElementById('boostFill');
const boostText = document.getElementById('boostText');
const leftTeamScoreElement = document.getElementById('leftTeamScore');
const rightTeamScoreElement = document.getElementById('rightTeamScore');
const leftTeamLabelElement = document.getElementById('leftTeamLabel');
const rightTeamLabelElement = document.getElementById('rightTeamLabel');

// Screen elements
const mainMenuScreen = document.getElementById('mainMenuScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');

// Main menu elements
const createRoomBtn = document.getElementById('createRoomBtn');
const roomNameInput = document.getElementById('roomNameInput');
const playerNameInput = document.getElementById('playerNameInput');

// Lobby browser elements
const lobbyList = document.getElementById('lobbyList');
const refreshLobbiesBtn = document.getElementById('refreshLobbiesBtn');

// Lobby elements
const startGameBtn = document.getElementById('startGameBtn');
const backToLobbyBtn = document.getElementById('backToLobbyBtn');
const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
const currentRoomName = document.getElementById('currentRoomName');
const unassignedPlayers = document.getElementById('unassignedPlayers');
const unassignedPlayerList = document.getElementById('unassignedPlayerList');

// Networking
let socket = null;
let connected = false;
let currentRoomId = null; // No default room anymore
let myRoomName = null;
let myPlayerId = null;
let myPlayerData = null;
let inRoom = false;

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
    inRoom = true;
    showLobbyScreen();
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

  socket.on('lobbyListUpdate', (lobbies) => {
    updateLobbyList(lobbies);
  });

  socket.on('error', (errorData) => {
    alert(errorData.message);
  });
}

// Update lobby UI from server data
function updateLobbyFromServer(roomState) {
  console.log('Updating lobby with room state:', roomState);

  // Clear all slots first
  document.querySelectorAll('.player-slot').forEach(slot => {
    slot.classList.remove('filled');
    slot.classList.add('empty');
    slot.querySelector('.slot-text').textContent = 'Click to Join';
  });

  // Group players by team
  const redPlayers = roomState.players.filter(p => p.team === 'red');
  const bluePlayers = roomState.players.filter(p => p.team === 'blue');
  const unassignedPlayersData = roomState.players.filter(p => !p.team || p.team === null);

  // Fill red team slots
  redPlayers.forEach((player, index) => {
    const redSlots = document.querySelectorAll('[data-team="red"]');
    if (index < redSlots.length) {
      const slot = redSlots[index];
      slot.classList.remove('empty');
      slot.classList.add('filled');

      // Add crown icon for owner
      const displayName = player.id === roomState.ownerId ? `👑 ${player.name}` : player.name;
      slot.querySelector('.slot-text').textContent = displayName;
    }
  });

  // Fill blue team slots
  bluePlayers.forEach((player, index) => {
    const blueSlots = document.querySelectorAll('[data-team="blue"]');
    if (index < blueSlots.length) {
      const slot = blueSlots[index];
      slot.classList.remove('empty');
      slot.classList.add('filled');

      // Add crown icon for owner
      const displayName = player.id === roomState.ownerId ? `👑 ${player.name}` : player.name;
      slot.querySelector('.slot-text').textContent = displayName;
    }
  });

  // Update unassigned players list
  updateUnassignedPlayersList(unassignedPlayersData, roomState.ownerId);

  // Update start button - only show to owner and enable if we have players on teams
  const isOwner = roomState.ownerId === myPlayerId;
  const playersOnTeams = redPlayers.length + bluePlayers.length;

  if (isOwner) {
    startGameBtn.style.display = 'block';
    startGameBtn.disabled = playersOnTeams === 0;
  } else {
    startGameBtn.style.display = 'none';
  }

  const lobbyInfo = document.querySelector('.lobby-info');
  if (isOwner) {
    if (playersOnTeams > 0) {
      lobbyInfo.textContent = `You can start the game! ${playersOnTeams} players on teams, ${unassignedPlayersData.length} waiting`;
    } else {
      lobbyInfo.textContent = 'Waiting for players to join teams...';
    }
  } else {
    const ownerPlayer = roomState.players.find(p => p.id === roomState.ownerId);
    const ownerName = ownerPlayer ? ownerPlayer.name : 'Owner';
    lobbyInfo.textContent = `Waiting for ${ownerName} 👑 to start the game... (${playersOnTeams} on teams, ${unassignedPlayersData.length} waiting)`;
  }
}

function updateUnassignedPlayersList(unassignedPlayersData, ownerId) {
  // Show/hide the unassigned players section
  if (unassignedPlayersData.length > 0) {
    unassignedPlayers.style.display = 'block';

    // Clear and populate the list
    unassignedPlayerList.innerHTML = '';

    unassignedPlayersData.forEach(player => {
      const playerElement = document.createElement('div');
      playerElement.className = 'unassigned-player';

      // Highlight local player
      if (player.id === myPlayerId) {
        playerElement.classList.add('local');
      }

      // Add crown for owner and show their name
      const displayName = player.id === ownerId ? `👑 ${player.name}` : player.name;
      playerElement.textContent = displayName;
      unassignedPlayerList.appendChild(playerElement);
    });
  } else {
    unassignedPlayers.style.display = 'none';
  }
}

// Show game screen
function showGameScreen() {
  mainMenuScreen.style.display = 'none';
  lobbyScreen.style.display = 'none';
  gameScreen.style.display = 'block';

  // Start render loop
  renderLoop();
}

// Show main menu screen
function showMainMenuScreen() {
  mainMenuScreen.style.display = 'block';
  lobbyScreen.style.display = 'none';
  gameScreen.style.display = 'none';
}

// Show lobby screen
function showLobbyScreen() {
  mainMenuScreen.style.display = 'none';
  lobbyScreen.style.display = 'block';
  gameScreen.style.display = 'none';

  // Update room name display
  if (myRoomName) {
    currentRoomName.textContent = `Room: ${myRoomName}`;
  }
}

// Input handling
document.addEventListener('keydown', (e) => {
  // Only handle game input when actually in the game screen
  if (gameScreen.style.display !== 'block') {
    return;
  }

  const key = e.key.toLowerCase();
  keys[key] = true;

  // Prevent default browser behaviors for game keys
  if (key === ' ' || key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
    e.preventDefault();
  }

  sendInput();
});

document.addEventListener('keyup', (e) => {
  // Only handle game input when actually in the game screen
  if (gameScreen.style.display !== 'block') {
    return;
  }

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

// Lobby list management
function updateLobbyList(lobbies) {
  console.log('Received lobby list:', lobbies);

  if (!lobbies || lobbies.length === 0) {
    lobbyList.innerHTML = '<div class="no-lobbies">No active lobbies</div>';
    return;
  }

  lobbyList.innerHTML = '';

  lobbies.forEach(lobby => {
    const lobbyItem = document.createElement('div');
    lobbyItem.className = `lobby-item ${lobby.playerCount >= 4 ? 'full' : ''}`;
    lobbyItem.dataset.roomId = lobby.id;

    lobbyItem.innerHTML = `
            <div class="lobby-name">${lobby.id}</div>
            <div class="lobby-players">
                <span class="player-count">${lobby.playerCount}/4</span>
                <span>players</span>
            </div>
        `;

    // Add click handler if room isn't full
    if (lobby.playerCount < 4) {
      lobbyItem.addEventListener('click', () => handleLobbyClick(lobby.id));
    }

    lobbyList.appendChild(lobbyItem);
  });
}

function handleLobbyClick(roomId) {
  if (!connected) {
    alert('Not connected to server!');
    return;
  }

  const playerName = playerNameInput.value.trim() || 'Player';
  joinRoom(roomId, playerName);
}

function requestLobbyList() {
  if (socket && connected) {
    socket.emit('requestLobbyList');
  }
}

// Main menu functions
function initializeMainMenu() {
  createRoomBtn.addEventListener('click', handleCreateRoom);
  refreshLobbiesBtn.addEventListener('click', requestLobbyList);

  // Enter key handlers for inputs
  roomNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleCreateRoom();
  });

  // Request initial lobby list
  setTimeout(() => {
    requestLobbyList();
  }, 500);
}

function handleCreateRoom() {
  const roomName = roomNameInput.value.trim();
  if (!roomName) {
    alert('Please enter a room name!');
    return;
  }

  if (!connected) {
    alert('Not connected to server!');
    return;
  }

  const playerName = playerNameInput.value.trim() || 'Player';
  joinRoom(roomName, playerName);
}

function joinRoom(roomName, playerName) {
  currentRoomId = roomName;
  myRoomName = roomName;

  // Don't join a team yet, just join the room
  socket.emit('joinRoom', {
    roomId: roomName,
    playerData: { name: playerName, team: null }
  });
}

function leaveRoom() {
  if (socket && currentRoomId) {
    socket.emit('leaveRoom', { roomId: currentRoomId });
  }

  currentRoomId = null;
  myRoomName = null;
  inRoom = false;
  showMainMenuScreen();
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
  leaveLobbyBtn.addEventListener('click', leaveRoom);
}

function handleSlotClick(event) {
  if (!connected || !inRoom) {
    alert('Not connected or not in a room!');
    return;
  }

  const slot = event.currentTarget;
  const team = slot.dataset.team;

  if (slot.classList.contains('empty')) {
    // Join this team (player is already in room)
    socket.emit('joinTeam', {
      roomId: currentRoomId,
      team: team
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
  if (inRoom) {
    showLobbyScreen();
  } else {
    showMainMenuScreen();
  }
  // Could emit 'leaveGame' to server if needed
}

// Initialize everything
function init() {
  console.log('Boost Arena Multiplayer starting...');

  initNetwork();
  initializeMainMenu();
  initializeLobby();

  // Show main menu initially
  showMainMenuScreen();
}

// Start the initialization when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
} 