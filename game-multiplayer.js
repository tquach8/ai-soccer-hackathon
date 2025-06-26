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
const winningScreen = document.getElementById('winningScreen');

// Main menu elements
const createRoomBtn = document.getElementById('createRoomBtn');
const roomNameInput = document.getElementById('roomNameInput');
const playerNameInput = document.getElementById('playerNameInput');

// Lobby browser elements
const lobbyList = document.getElementById('lobbyList');
const refreshLobbiesBtn = document.getElementById('refreshLobbiesBtn');

// Leaderboard elements
const leaderboardList = document.getElementById('leaderboardList');
const mainLeaderboardList = document.getElementById('mainLeaderboardList');
const refreshLeaderboardBtn = document.getElementById('refreshLeaderboardBtn');
const mainRefreshLeaderboardBtn = document.getElementById('mainRefreshLeaderboardBtn');

// Lobby elements
const startGameBtn = document.getElementById('startGameBtn');
const backToLobbyBtn = document.getElementById('backToLobbyBtn');
const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
const currentRoomName = document.getElementById('currentRoomName');
const unassignedPlayers = document.getElementById('unassignedPlayers');
const unassignedPlayerList = document.getElementById('unassignedPlayerList');

// Winning screen elements
const winnerTitle = document.getElementById('winnerTitle');
const finalScore = document.getElementById('finalScore');
const redPlayerStats = document.getElementById('redPlayerStats');
const bluePlayerStats = document.getElementById('bluePlayerStats');
const playAgainBtn = document.getElementById('playAgainBtn');
const backToMenuBtn = document.getElementById('backToMenuBtn');

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

// Dynamic canvas sizing
function resizeCanvas(width, height) {
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
}

// Set initial canvas size (will be updated when game starts)
resizeCanvas(700, 400);

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

    // Hide auth screen if guest joined a lobby
    if (authManager && authManager.isPlayingAsGuest()) {
      authManager.hideAuthScreen();
    }
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

  socket.on('gameEnded', (gameResults) => {
    console.log('Game ended:', gameResults);
    showWinningScreen(gameResults);
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
  winningScreen.style.display = 'none';

  // Start render loop
  renderLoop();
}

// Show main menu screen
function showMainMenuScreen() {
  // Check if guest should see auth screen instead
  if (authManager && authManager.isPlayingAsGuest() && !authManager.isAuthenticated()) {
    authManager.showAuthScreenIfGuest();
    lobbyScreen.style.display = 'none';
    gameScreen.style.display = 'none';
    winningScreen.style.display = 'none';
  } else {
    mainMenuScreen.style.display = 'block';
    lobbyScreen.style.display = 'none';
    gameScreen.style.display = 'none';
    winningScreen.style.display = 'none';

    // Refresh leaderboard when showing main menu
    setTimeout(() => {
      fetchLeaderboard();
    }, 100);
  }
}

// Show lobby screen
function showLobbyScreen() {
  mainMenuScreen.style.display = 'none';
  lobbyScreen.style.display = 'block';
  gameScreen.style.display = 'none';
  winningScreen.style.display = 'none';

  // Update room name display
  if (myRoomName) {
    currentRoomName.textContent = `Room: ${myRoomName}`;
  }
}

// Show winning screen
function showWinningScreen(gameResults) {
  mainMenuScreen.style.display = 'none';
  lobbyScreen.style.display = 'none';
  gameScreen.style.display = 'none';
  winningScreen.style.display = 'block';

  // Update winner announcement
  const winningTeam = gameResults.winningTeam;
  const teamEmoji = winningTeam === 'red' ? '🔴' : '🔵';
  const teamName = winningTeam.charAt(0).toUpperCase() + winningTeam.slice(1);

  winnerTitle.textContent = `🎉 ${teamEmoji} ${teamName} Team Wins! 🎉`;
  winnerTitle.className = `winner-title ${winningTeam}`;

  finalScore.textContent = `Final Score: ${gameResults.finalScores.red} - ${gameResults.finalScores.blue}`;

  // Populate team statistics
  populateTeamStats('red', gameResults.playerStats.red);
  populateTeamStats('blue', gameResults.playerStats.blue);
}

function populateTeamStats(team, playerStats) {
  const container = team === 'red' ? redPlayerStats : bluePlayerStats;
  container.innerHTML = '';

  if (playerStats.length === 0) {
    container.innerHTML = '<div class="no-goals">No players on this team</div>';
    return;
  }

  playerStats.forEach(player => {
    const playerElement = document.createElement('div');
    playerElement.className = 'player-stat';

    playerElement.innerHTML = `
      <span class="player-name">${player.name}</span>
      <span class="player-goals">${player.goals} ${player.goals === 1 ? 'goal' : 'goals'}</span>
    `;

    container.appendChild(playerElement);
  });

  // Add a message if no one scored
  if (playerStats.every(player => player.goals === 0)) {
    const noGoalsElement = document.createElement('div');
    noGoalsElement.className = 'no-goals';
    noGoalsElement.textContent = 'No goals scored by this team';
    container.appendChild(noGoalsElement);
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
  // Resize canvas if map dimensions changed
  if (gameState.mapDimensions) {
    resizeCanvas(gameState.mapDimensions.width, gameState.mapDimensions.height);
  }

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
  // Use dynamic dimensions from game state, fallback to canvas size
  const mapWidth = gameState.mapDimensions ? gameState.mapDimensions.width : canvas.width;
  const mapHeight = gameState.mapDimensions ? gameState.mapDimensions.height : canvas.height;
  const goalHeight = gameState.goalHeight || 120;

  // Clear canvas with cyber background
  const time = Date.now() * 0.001; // For animations

  // Create gradient background
  const gradient = ctx.createRadialGradient(mapWidth / 2, mapHeight / 2, 0, mapWidth / 2, mapHeight / 2, Math.max(mapWidth, mapHeight) / 2);
  gradient.addColorStop(0, '#0a1a2a');
  gradient.addColorStop(0.7, '#0f2a3a');
  gradient.addColorStop(1, '#051520');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw cyber grid pattern
  ctx.save();
  ctx.strokeStyle = `rgba(0, 255, 255, ${0.15 + Math.sin(time * 2) * 0.05})`;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  const gridSize = 50;
  ctx.beginPath();
  // Vertical lines
  for (let x = 0; x <= mapWidth; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, mapHeight);
  }
  // Horizontal lines
  for (let y = 0; y <= mapHeight; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(mapWidth, y);
  }
  ctx.stroke();
  ctx.restore();

  // Add animated scan lines
  ctx.save();
  ctx.strokeStyle = `rgba(0, 255, 255, ${0.3 + Math.sin(time * 3) * 0.2})`;
  ctx.lineWidth = 2;
  const scanY = (time * 100) % (mapHeight + 100) - 50;
  ctx.beginPath();
  ctx.moveTo(0, scanY);
  ctx.lineTo(mapWidth, scanY);
  ctx.stroke();
  ctx.restore();

  // Draw cyber field boundary with glow
  ctx.save();
  ctx.strokeStyle = '#00ffff';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur = 15;
  ctx.strokeRect(0, 0, mapWidth, mapHeight);
  ctx.restore();

  // Draw center line with neon effect
  ctx.save();
  ctx.strokeStyle = '#00ffff';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur = 10;
  ctx.setLineDash([10, 5]);
  ctx.beginPath();
  ctx.moveTo(mapWidth / 2, 0);
  ctx.lineTo(mapWidth / 2, mapHeight);
  ctx.stroke();
  ctx.restore();

  // Draw center circle with cyber styling
  ctx.save();
  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#ff00ff';
  ctx.shadowBlur = 15;
  ctx.setLineDash([15, 8]);
  ctx.beginPath();
  ctx.arc(mapWidth / 2, mapHeight / 2, 80, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Add pulsing center circle fill
  ctx.save();
  ctx.fillStyle = `rgba(255, 0, 255, ${0.1 + Math.sin(time * 4) * 0.05})`;
  ctx.beginPath();
  ctx.arc(mapWidth / 2, mapHeight / 2, 80, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Show kickoff restriction zone with enhanced cyber effects
  if (gameState.kickoffActive && gameState.kickoffTeam) {
    const kickoffColor = gameState.kickoffTeam === 'red' ?
      `rgba(255, 68, 68, ${0.2 + Math.sin(time * 6) * 0.1})` :
      `rgba(68, 136, 255, ${0.2 + Math.sin(time * 6) * 0.1})`;
    const kickoffBorderColor = gameState.kickoffTeam === 'red' ? '#ff4444' : '#4488ff';

    ctx.save();
    ctx.fillStyle = kickoffColor;
    ctx.beginPath();
    ctx.arc(mapWidth / 2, mapHeight / 2, 80, 0, Math.PI * 2);
    ctx.fill();

    // Animated border for restriction zone
    ctx.strokeStyle = kickoffBorderColor;
    ctx.lineWidth = 4;
    ctx.shadowColor = kickoffBorderColor;
    ctx.shadowBlur = 20;
    ctx.setLineDash([15, 10]);
    ctx.lineDashOffset = time * 30;
    ctx.beginPath();
    ctx.arc(mapWidth / 2, mapHeight / 2, 80, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Draw cyber goals with energy effects
  function drawCyberGoal(x, y, width, height, isLeft) {
    ctx.save();

    // Goal base with gradient
    const goalGradient = ctx.createLinearGradient(x, y, x + width, y);
    goalGradient.addColorStop(0, isLeft ? '#ff0040' : '#ff0040');
    goalGradient.addColorStop(0.5, '#ff4080');
    goalGradient.addColorStop(1, '#ff0040');
    ctx.fillStyle = goalGradient;
    ctx.fillRect(x, y, width, height);

    // Goal glow effect
    ctx.shadowColor = '#ff0040';
    ctx.shadowBlur = 25;
    ctx.fillRect(x, y, width, height);

    // Energy lines inside goal
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ffff00';
    ctx.shadowBlur = 10;

    const numLines = 5;
    for (let i = 1; i < numLines; i++) {
      const lineY = y + (height / numLines) * i;
      const offset = Math.sin(time * 4 + i) * 3;
      ctx.beginPath();
      ctx.moveTo(x + offset, lineY);
      ctx.lineTo(x + width + offset, lineY);
      ctx.stroke();
    }

    // Goal post highlights
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 15;
    ctx.strokeRect(x, y, width, height);

    ctx.restore();
  }

  // Draw goals
  drawCyberGoal(0, mapHeight / 2 - goalHeight / 2, 20, goalHeight, true);
  drawCyberGoal(mapWidth - 20, mapHeight / 2 - goalHeight / 2, 20, goalHeight, false);

  // Draw cyber boost pads
  gameState.boostPads.forEach((pad, index) => {
    ctx.save();

    if (pad.active) {
      // Active boost pad with cyber effects
      const pulseSize = 25 + Math.sin(time * 5 + index) * 5;

      // Outer glow
      ctx.shadowColor = '#00ff00';
      ctx.shadowBlur = 30;
      ctx.fillStyle = `rgba(0, 255, 0, ${0.3 + Math.sin(time * 3 + index) * 0.2})`;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pulseSize, 0, Math.PI * 2);
      ctx.fill();

      // Inner core
      ctx.shadowBlur = 15;
      ctx.fillStyle = '#00ff00';
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 18, 0, Math.PI * 2);
      ctx.fill();

      // Energy ring
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 10;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = time * 20;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 22, 0, Math.PI * 2);
      ctx.stroke();

      // "BOOST" text with glow
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 10px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#00ff00';
      ctx.shadowBlur = 5;
      ctx.fillText('BOOST', pad.x, pad.y - 2);
      ctx.fillText('PAD', pad.x, pad.y + 8);

    } else {
      // Inactive boost pad with cooldown visual
      ctx.fillStyle = '#333333';
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 18, 0, Math.PI * 2);
      ctx.fill();

      // Cooldown progress ring
      const progress = 1 - (pad.cooldown / pad.maxCooldown);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#00ff00';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 22, -Math.PI / 2, -Math.PI / 2 + (progress * Math.PI * 2));
      ctx.stroke();

      // Dim text
      ctx.fillStyle = '#666666';
      ctx.font = 'bold 8px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.shadowBlur = 0;
      ctx.fillText('BOOST', pad.x, pad.y - 1);
      ctx.fillText('PAD', pad.x, pad.y + 7);
    }
    ctx.restore();
  });

  // Draw cyber ball with energy trail
  ctx.save();

  // Ball energy aura
  const ballSpeed = Math.sqrt(gameState.ball.vx ** 2 + gameState.ball.vy ** 2);
  const energyRadius = 15 + Math.min(ballSpeed * 2, 20);

  if (ballSpeed > 2) {
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(ballSpeed * 0.1, 0.4)})`;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 25;
    ctx.beginPath();
    ctx.arc(gameState.ball.x, gameState.ball.y, energyRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Main ball with gradient
  const ballGradient = ctx.createRadialGradient(
    gameState.ball.x - 5, gameState.ball.y - 5, 0,
    gameState.ball.x, gameState.ball.y, gameState.ball.radius
  );
  ballGradient.addColorStop(0, '#ffffff');
  ballGradient.addColorStop(0.7, '#cccccc');
  ballGradient.addColorStop(1, '#888888');

  ctx.fillStyle = ballGradient;
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.arc(gameState.ball.x, gameState.ball.y, gameState.ball.radius, 0, Math.PI * 2);
  ctx.fill();

  // Ball highlight
  ctx.fillStyle = '#ffffff';
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.arc(gameState.ball.x - 3, gameState.ball.y - 3, gameState.ball.radius * 0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Draw cyber players
  gameState.players.forEach(player => {
    const isLocalPlayer = player.id === myPlayerId;
    const isKicking = isLocalPlayer && keys[' '];
    const isBoosting = (isLocalPlayer && keys['shift'] && player.boost > 0) ||
      (!isLocalPlayer && player.keys && player.keys.shift && player.boost > 0);

    ctx.save();

    // Player base color
    let playerColor = player.team === 'red' ? '#ff4444' : '#4488ff';
    let glowColor = playerColor;
    let glowIntensity = 10;

    if (isKicking) {
      // Kicking effect - electric white
      playerColor = '#ffffff';
      glowColor = '#ffff00';
      glowIntensity = 30;

      // Electric sparks around player
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 15;

      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + time * 8;
        const sparkLength = 15 + Math.random() * 10;
        const startX = player.x + Math.cos(angle) * 25;
        const startY = player.y + Math.sin(angle) * 25;
        const endX = startX + Math.cos(angle + Math.random() - 0.5) * sparkLength;
        const endY = startY + Math.sin(angle + Math.random() - 0.5) * sparkLength;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

    } else if (isBoosting) {
      // Boosting effect - cyan energy
      playerColor = '#00ffff';
      glowColor = '#00ffff';
      glowIntensity = 25;

      // Boost trail particles
      ctx.fillStyle = `rgba(0, 255, 255, ${0.5 + Math.sin(time * 10) * 0.3})`;
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 20;

      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 30 + Math.random() * 15;
        const particleX = player.x + Math.cos(angle) * distance;
        const particleY = player.y + Math.sin(angle) * distance;
        const size = 2 + Math.random() * 3;

        ctx.beginPath();
        ctx.arc(particleX, particleY, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player glow aura
    ctx.fillStyle = `rgba(${glowColor === '#ff4444' ? '255,68,68' :
      glowColor === '#4488ff' ? '68,136,255' :
        glowColor === '#00ffff' ? '0,255,255' : '255,255,255'}, 0.3)`;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glowIntensity;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
    ctx.fill();

    // Main player body with gradient
    const playerGradient = ctx.createRadialGradient(
      player.x - 5, player.y - 5, 0,
      player.x, player.y, 20
    );
    playerGradient.addColorStop(0, playerColor);
    playerGradient.addColorStop(0.7, playerColor);
    playerGradient.addColorStop(1, '#000000');

    ctx.fillStyle = playerGradient;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glowIntensity;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Player number/ID ring
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(player.x, player.y, 23, 0, Math.PI * 2);
    ctx.stroke();

    // Player name with cyber styling
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;
    ctx.fillText(player.name.toUpperCase(), player.x, player.y - 35);

    // Direction indicator for local player
    if (isLocalPlayer) {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 10;
      ctx.setLineDash([]);
      ctx.beginPath();
      const lookX = player.x + Math.cos(Math.atan2(gameState.ball.y - player.y, gameState.ball.x - player.x)) * 30;
      const lookY = player.y + Math.sin(Math.atan2(gameState.ball.y - player.y, gameState.ball.x - player.x)) * 30;
      ctx.moveTo(player.x, player.y);
      ctx.lineTo(lookX, lookY);
      ctx.stroke();

      // Arrow head
      const angle = Math.atan2(gameState.ball.y - player.y, gameState.ball.x - player.x);
      ctx.beginPath();
      ctx.moveTo(lookX, lookY);
      ctx.lineTo(lookX - 8 * Math.cos(angle - 0.3), lookY - 8 * Math.sin(angle - 0.3));
      ctx.moveTo(lookX, lookY);
      ctx.lineTo(lookX - 8 * Math.cos(angle + 0.3), lookY - 8 * Math.sin(angle + 0.3));
      ctx.stroke();
    }

    ctx.restore();
  });

  // Add atmospheric effects
  ctx.save();

  // Floating energy particles
  for (let i = 0; i < 12; i++) {
    const x = (i * 100 + time * 20 + Math.sin(time + i) * 30) % (mapWidth + 100);
    const y = (i * 50 + Math.cos(time * 0.5 + i) * 50) % (mapHeight + 50);
    const size = 1 + Math.sin(time * 3 + i) * 0.5;
    const alpha = 0.3 + Math.sin(time * 2 + i) * 0.2;

    ctx.fillStyle = `rgba(0, 255, 255, ${alpha})`;
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// Client-side prediction for smooth movement
function predictLocalPlayer() {
  if (!localPlayer || !connected) return;

  // Get current map dimensions
  const mapWidth = gameState.mapDimensions ? gameState.mapDimensions.width : 700;
  const mapHeight = gameState.mapDimensions ? gameState.mapDimensions.height : 400;

  // Predict local player movement for smooth controls
  const deltaTime = 16; // Assume 60fps
  let speed = 1.5; // PLAYER_SPEED

  if (keys['shift'] && localPlayer.boost > 0) {
    speed = 2.7; // BOOST_SPEED - increased to match server
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

  // Keep in bounds using dynamic dimensions
  const outOfBoundsBuffer = 20 * 0.6;
  localPlayer.x = Math.min(Math.max(localPlayer.x, -outOfBoundsBuffer), mapWidth + outOfBoundsBuffer);
  localPlayer.y = Math.min(Math.max(localPlayer.y, -outOfBoundsBuffer), mapHeight + outOfBoundsBuffer);
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
  const lobbyList = document.getElementById('lobbyList');

  if (lobbies.length === 0) {
    lobbyList.innerHTML = '<div class="no-lobbies">No active lobbies</div>';
    return;
  }

  lobbyList.innerHTML = '';

  lobbies.forEach(lobby => {
    const lobbyItem = document.createElement('div');
    lobbyItem.className = `lobby-item ${lobby.playerCount >= 8 ? 'full' : ''}`;

    lobbyItem.innerHTML = `
      <div class="lobby-info">
        <span class="lobby-name">${lobby.id}</span>
        <span class="player-count">${lobby.playerCount}/8</span>
      </div>
      <div class="lobby-status">${lobby.gameState}</div>
    `;

    if (lobby.playerCount < 8) {
      lobbyItem.style.cursor = 'pointer';
      lobbyItem.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim() || 'Player';
        joinRoom(lobby.id, playerName);
      });
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

// Leaderboard management
async function fetchLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard?limit=10');
    const leaderboard = await response.json();

    if (response.ok) {
      updateLeaderboardDisplay(leaderboard);
    } else {
      console.error('Failed to fetch leaderboard:', leaderboard.error);
      // Update both leaderboard lists with error message
      const errorMessage = '<div class="no-leaderboard">Failed to load leaderboard</div>';
      if (leaderboardList) leaderboardList.innerHTML = errorMessage;
      if (mainLeaderboardList) mainLeaderboardList.innerHTML = errorMessage;
    }
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    // Update both leaderboard lists with error message
    const errorMessage = '<div class="no-leaderboard">Failed to load leaderboard</div>';
    if (leaderboardList) leaderboardList.innerHTML = errorMessage;
    if (mainLeaderboardList) mainLeaderboardList.innerHTML = errorMessage;
  }
}

function updateLeaderboardDisplay(leaderboard) {
  const leaderboardLists = [leaderboardList, mainLeaderboardList].filter(list => list);

  if (leaderboard.length === 0) {
    const noDataMessage = '<div class="no-leaderboard">No players have completed games yet</div>';
    leaderboardLists.forEach(list => {
      list.innerHTML = noDataMessage;
    });
    return;
  }

  leaderboardLists.forEach(list => {
    list.innerHTML = '';

    leaderboard.forEach((player, index) => {
      const rank = index + 1;
      const leaderboardItem = document.createElement('div');
      leaderboardItem.className = `leaderboard-item`;

      // Add special styling for top 3
      if (rank <= 3) {
        leaderboardItem.classList.add('top-3', `rank-${rank}`);
      }

      // Format win rate
      const winRate = player.win_rate || 0;

      leaderboardItem.innerHTML = `
        <div class="player-info">
          <span class="player-rank">#${rank}</span>
          <span class="player-username">${player.username}</span>
        </div>
        <div class="player-stats">
          <div class="stat-wins">${player.total_wins} wins</div>
          <div class="stat-goals">${player.total_goals} goals</div>
        </div>
      `;

      list.appendChild(leaderboardItem);
    });
  });
}

// Main menu functions
function initializeMainMenu() {
  createRoomBtn.addEventListener('click', handleCreateRoom);
  refreshLobbiesBtn.addEventListener('click', requestLobbyList);
  refreshLeaderboardBtn.addEventListener('click', fetchLeaderboard);
  if (mainRefreshLeaderboardBtn) {
    mainRefreshLeaderboardBtn.addEventListener('click', fetchLeaderboard);
  }

  // Enter key handlers for inputs
  roomNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleCreateRoom();
  });

  // Request initial data
  setTimeout(() => {
    requestLobbyList();
    fetchLeaderboard();
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

  // Winning screen button listeners
  playAgainBtn.addEventListener('click', () => {
    if (inRoom) {
      showLobbyScreen();
    } else {
      showMainMenuScreen();
    }
  });

  backToMenuBtn.addEventListener('click', () => {
    leaveRoom();
    showMainMenuScreen();
    // Refresh leaderboard to show updated stats
    setTimeout(() => {
      fetchLeaderboard();
    }, 1000);
  });
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
  console.log('Blitz Ball Multiplayer starting...');

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