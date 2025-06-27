// Multiplayer game client
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const boostFill = document.getElementById('boostFill');
const boostText = document.getElementById('boostText');
const leftTeamScoreElement = document.getElementById('leftTeamScore');
const rightTeamScoreElement = document.getElementById('rightTeamScore');
const leftTeamLabelElement = document.getElementById('leftTeamLabel');
const rightTeamLabelElement = document.getElementById('rightTeamLabel');

// Audio System
let audioContext = null;
let lastScores = { red: 0, blue: 0 }; // Track score changes
let lastBallState = { x: 0, y: 0, vx: 0, vy: 0 }; // Track ball changes for kick detection

// Initialize audio context (requires user interaction)
function initAudio() {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.log('Web Audio API not supported');
    }
  }
}

// Play kick sound
function playKickSound() {
  if (!audioContext) {
    console.log('No audio context for kick sound');
    return;
  }

  try {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Kick sound: more pronounced thump
    oscillator.frequency.setValueAtTime(120, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(60, audioContext.currentTime + 0.15);

    gainNode.gain.setValueAtTime(0.5, audioContext.currentTime); // Increased volume
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.25);

    oscillator.type = 'sine';
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.25);

    console.log('Kick sound played successfully');
  } catch (e) {
    console.log('Error playing kick sound:', e);
  }
}

// Play goal sound
function playGoalSound() {
  if (!audioContext) return;

  try {
    // Create a celebratory ascending tone sequence
    const playTone = (freq, startTime, duration) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.setValueAtTime(freq, startTime);
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.2, startTime + 0.05);
      gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    // Goal celebration: ascending notes
    const now = audioContext.currentTime;
    playTone(440, now, 0.3);      // A4
    playTone(554, now + 0.15, 0.3); // C#5  
    playTone(659, now + 0.3, 0.4);  // E5
    playTone(880, now + 0.5, 0.5);  // A5

  } catch (e) {
    console.log('Error playing goal sound:', e);
  }
}

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

// Leaderboard elements
const leaderboardList = document.getElementById('leaderboardList');
const mainLeaderboardList = document.getElementById('mainLeaderboardList');

// Online members elements
const onlineMembersList = document.getElementById('onlineMembersList');

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

  socket.on('gameStarted', (gameStartData) => {
    console.log('Game started!');
    gameState.gameState = 'playing';

    // Set owner ID if provided
    if (gameStartData && gameStartData.ownerId) {
      gameState.ownerId = gameStartData.ownerId;
    }

    showGameScreen();
  });

  socket.on('gameState', (serverGameState) => {
    gameState = serverGameState;
    lastServerUpdate = Date.now();

    // Update local player reference for prediction
    localPlayer = gameState.players.find(p => p.id === myPlayerId);

    // Update back to lobby button visibility based on owner status
    updateBackToLobbyButton();

    updateClientGameState();
  });

  socket.on('lobbyListUpdate', (lobbies) => {
    updateLobbyList(lobbies);
  });

  socket.on('gameEnded', (gameResults) => {
    console.log('Game ended:', gameResults);
    showWinningScreen(gameResults);
  });

  socket.on('returnedToLobby', (roomState) => {
    console.log('Everyone returned to lobby by room owner');
    gameState.gameState = 'lobby';
    showLobbyScreen();
    updateLobbyFromServer(roomState);
  });

  socket.on('error', (errorData) => {
    alert(errorData.message);
  });

  socket.on('onlineMembersUpdate', (members) => {
    updateOnlineMembersDisplay(members);
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

  // Update start button - only show to owner and enable if we have players on each team
  const isOwner = roomState.ownerId === myPlayerId;
  const playersOnTeams = redPlayers.length + bluePlayers.length;
  const canStartGame = redPlayers.length > 0 && bluePlayers.length > 0; // Need at least 1 player per team

  if (isOwner) {
    startGameBtn.style.display = 'block';
    startGameBtn.disabled = !canStartGame;
  } else {
    startGameBtn.style.display = 'none';
  }

  const lobbyInfo = document.querySelector('.lobby-info');
  if (isOwner) {
    if (canStartGame) {
      lobbyInfo.textContent = `You can start the game! ${playersOnTeams} players on teams, ${unassignedPlayersData.length} waiting`;
    } else if (playersOnTeams === 0) {
      lobbyInfo.textContent = 'Waiting for players to join teams...';
    } else {
      lobbyInfo.textContent = `Need players on both teams to start! Red: ${redPlayers.length}, Blue: ${bluePlayers.length}`;
    }
  } else {
    const ownerPlayer = roomState.players.find(p => p.id === roomState.ownerId);
    const ownerName = ownerPlayer ? ownerPlayer.name : 'Owner';
    if (canStartGame) {
      lobbyInfo.textContent = `Waiting for ${ownerName} 👑 to start the game... (${playersOnTeams} on teams, ${unassignedPlayersData.length} waiting)`;
    } else {
      lobbyInfo.textContent = `Waiting for players on both teams... Red: ${redPlayers.length}, Blue: ${bluePlayers.length}`;
    }
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

  // Update button visibility based on owner status
  updateBackToLobbyButton();

  // Initialize audio for game sounds
  if (!audioContext) {
    initAudio();
  }

  // Start render loop
  renderLoop();
}

// Update back to lobby button visibility
function updateBackToLobbyButton() {
  if (gameScreen.style.display === 'block') {
    const isOwner = gameState.ownerId === myPlayerId;
    if (isOwner) {
      backToLobbyBtn.style.display = 'block';
    } else {
      backToLobbyBtn.style.display = 'none';
    }
  }
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
    lobbyScreen.style.display = 'none';
    gameScreen.style.display = 'none';
    winningScreen.style.display = 'none';

    // Refresh data when showing main menu
    setTimeout(() => {
      fetchLeaderboard();
      requestOnlineMembers(); // Request fresh online members for authenticated users
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

  // Initialize audio on first user interaction
  if (!audioContext) {
    initAudio();
  }

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

  // Check for goal scored (score changed)
  if (gameState.scores.red !== lastScores.red || gameState.scores.blue !== lastScores.blue) {
    // Initialize audio if needed
    if (!audioContext) {
      initAudio();
    }

    // Play goal sound
    playGoalSound();

    // Update last scores
    lastScores.red = gameState.scores.red;
    lastScores.blue = gameState.scores.blue;
  }

  // Check for ball kick (velocity change + player proximity)
  if (lastBallState.x !== 0 || lastBallState.y !== 0) { // Skip first update
    const velocityChange = Math.sqrt(
      Math.pow(gameState.ball.vx - lastBallState.vx, 2) +
      Math.pow(gameState.ball.vy - lastBallState.vy, 2)
    );

    // If ball velocity changed significantly (indicating a kick)
    if (velocityChange > 1) { // Lowered from 3 to 1 for more sensitivity
      // Check if any player is close enough to the ball to have kicked it
      const kickDistance = 45; // Increased from 35 (player radius 20 + ball radius 15 + buffer 10)
      let ballKicked = false;
      let kickingPlayer = null;

      gameState.players.forEach(player => {
        const distance = Math.sqrt(
          Math.pow(player.x - gameState.ball.x, 2) +
          Math.pow(player.y - gameState.ball.y, 2)
        );
        if (distance < kickDistance) {
          ballKicked = true;
          kickingPlayer = player.name;
        }
      });

      if (ballKicked) {
        // Initialize audio if needed
        if (!audioContext) {
          initAudio();
        }
        console.log(`Ball kicked by ${kickingPlayer}, velocity change: ${velocityChange.toFixed(2)}`);
        playKickSound();
      }
    }
  }

  // Update last ball state for next comparison
  lastBallState = {
    x: gameState.ball.x,
    y: gameState.ball.y,
    vx: gameState.ball.vx,
    vy: gameState.ball.vy
  };

  // Update scores display
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

  // Clear canvas with subtle cyber background
  const time = Date.now() * 0.001; // For animations

  // Create subtle gradient background
  const gradient = ctx.createRadialGradient(mapWidth / 2, mapHeight / 2, 0, mapWidth / 2, mapHeight / 2, Math.max(mapWidth, mapHeight) / 2);
  gradient.addColorStop(0, '#0a1a2a');
  gradient.addColorStop(0.7, '#0d1f2a');
  gradient.addColorStop(1, '#081520');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw subtle grid pattern
  ctx.save();
  ctx.strokeStyle = `rgba(0, 200, 200, ${0.08 + Math.sin(time * 1.5) * 0.02})`;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  const gridSize = 60;
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

  // Draw field boundary with subtle glow
  ctx.save();
  ctx.strokeStyle = '#00cccc';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#00cccc';
  ctx.shadowBlur = 8;
  ctx.strokeRect(0, 0, mapWidth, mapHeight);
  ctx.restore();

  // Draw center line with clean neon effect
  ctx.save();
  ctx.strokeStyle = '#00cccc';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#00cccc';
  ctx.shadowBlur = 5;
  ctx.setLineDash([8, 4]);
  ctx.beginPath();
  ctx.moveTo(mapWidth / 2, 0);
  ctx.lineTo(mapWidth / 2, mapHeight);
  ctx.stroke();
  ctx.restore();

  // Draw center circle with subtle styling
  ctx.save();
  ctx.strokeStyle = '#cc00cc';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#cc00cc';
  ctx.shadowBlur = 6;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.arc(mapWidth / 2, mapHeight / 2, 80, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Show kickoff restriction zone with subtle effects
  if (gameState.kickoffActive && gameState.kickoffTeam) {
    const kickoffColor = gameState.kickoffTeam === 'red' ?
      `rgba(255, 68, 68, ${0.12 + Math.sin(time * 3) * 0.03})` :
      `rgba(68, 136, 255, ${0.12 + Math.sin(time * 3) * 0.03})`;
    const kickoffBorderColor = gameState.kickoffTeam === 'red' ? '#ff6666' : '#6699ff';

    ctx.save();
    ctx.fillStyle = kickoffColor;
    ctx.beginPath();
    ctx.arc(mapWidth / 2, mapHeight / 2, 80, 0, Math.PI * 2);
    ctx.fill();

    // Subtle animated border for restriction zone
    ctx.strokeStyle = kickoffBorderColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = kickoffBorderColor;
    ctx.shadowBlur = 8;
    ctx.setLineDash([12, 8]);
    ctx.lineDashOffset = time * 20;
    ctx.beginPath();
    ctx.arc(mapWidth / 2, mapHeight / 2, 80, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Draw cleaner cyber goals
  function drawCyberGoal(x, y, width, height, isLeft) {
    ctx.save();

    // Team colors: left goal = red team, right goal = blue team
    const primaryColor = isLeft ? '#cc3366' : '#3366cc';
    const secondaryColor = isLeft ? '#ff4477' : '#4477ff';
    const accentColor = isLeft ? '#ffcc44' : '#44ccff';
    const outlineColor = isLeft ? '#ff6666' : '#6666ff';

    // Goal base with team-colored gradient
    const goalGradient = ctx.createLinearGradient(x, y, x + width, y);
    goalGradient.addColorStop(0, primaryColor);
    goalGradient.addColorStop(0.5, secondaryColor);
    goalGradient.addColorStop(1, primaryColor);
    ctx.fillStyle = goalGradient;
    ctx.fillRect(x, y, width, height);

    // Team-colored goal glow
    ctx.shadowColor = secondaryColor;
    ctx.shadowBlur = 12;
    ctx.fillRect(x, y, width, height);

    // Simple energy lines inside goal with team accent color
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1;
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 4;

    const numLines = 3;
    for (let i = 1; i < numLines; i++) {
      const lineY = y + (height / numLines) * i;
      ctx.beginPath();
      ctx.moveTo(x + 2, lineY);
      ctx.lineTo(x + width - 2, lineY);
      ctx.stroke();
    }

    // Goal post outline with team color
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 2;
    ctx.shadowColor = outlineColor;
    ctx.shadowBlur = 6;
    ctx.strokeRect(x, y, width, height);

    ctx.restore();
  }

  // Draw goals with team colors
  drawCyberGoal(0, mapHeight / 2 - goalHeight / 2, 20, goalHeight, true);  // Red team goal
  drawCyberGoal(mapWidth - 20, mapHeight / 2 - goalHeight / 2, 20, goalHeight, false);  // Blue team goal

  // Draw cleaner boost pads
  gameState.boostPads.forEach((pad, index) => {
    ctx.save();

    if (pad.active) {
      // Active boost pad with subtle effects
      const pulseSize = 22 + Math.sin(time * 3 + index) * 2;

      // Subtle outer glow
      ctx.shadowColor = '#00ff44';
      ctx.shadowBlur = 15;
      ctx.fillStyle = `rgba(0, 255, 68, ${0.2 + Math.sin(time * 2 + index) * 0.1})`;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pulseSize, 0, Math.PI * 2);
      ctx.fill();

      // Inner core
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#00ff44';
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 16, 0, Math.PI * 2);
      ctx.fill();

      // Simple text
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 12px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.shadowBlur = 0;
      ctx.fillText('B', pad.x, pad.y + 4);

    } else {
      // Inactive boost pad
      ctx.fillStyle = '#444444';
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 16, 0, Math.PI * 2);
      ctx.fill();

      // Cooldown progress ring
      const progress = 1 - (pad.cooldown / pad.maxCooldown);
      ctx.strokeStyle = '#00ff44';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00ff44';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 19, -Math.PI / 2, -Math.PI / 2 + (progress * Math.PI * 2));
      ctx.stroke();

      // Dim text
      ctx.fillStyle = '#888888';
      ctx.font = 'bold 12px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.shadowBlur = 0;
      ctx.fillText('B', pad.x, pad.y + 4);
    }
    ctx.restore();
  });

  // Draw cleaner ball
  ctx.save();

  // Ball energy aura (only when moving fast)
  const ballSpeed = Math.sqrt(gameState.ball.vx ** 2 + gameState.ball.vy ** 2);

  if (ballSpeed > 4) {
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(ballSpeed * 0.05, 0.2)})`;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(gameState.ball.x, gameState.ball.y, gameState.ball.radius + 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Main ball with subtle gradient
  const ballGradient = ctx.createRadialGradient(
    gameState.ball.x - 3, gameState.ball.y - 3, 0,
    gameState.ball.x, gameState.ball.y, gameState.ball.radius
  );
  ballGradient.addColorStop(0, '#ffffff');
  ballGradient.addColorStop(0.8, '#dddddd');
  ballGradient.addColorStop(1, '#aaaaaa');

  ctx.fillStyle = ballGradient;
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(gameState.ball.x, gameState.ball.y, gameState.ball.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Draw cleaner players
  gameState.players.forEach(player => {
    const isLocalPlayer = player.id === myPlayerId;
    const isKicking = isLocalPlayer && keys[' '];
    const isBoosting = (isLocalPlayer && keys['shift'] && player.boost > 0) ||
      (!isLocalPlayer && player.keys && player.keys.shift && player.boost > 0);

    ctx.save();

    // Player base color
    let playerColor = player.team === 'red' ? '#ff6666' : '#6699ff';
    let glowColor = playerColor;
    let glowIntensity = 6;

    if (isKicking) {
      // Kicking effect - clean white with yellow accent
      playerColor = '#ffffff';
      glowColor = '#ffcc44';
      glowIntensity = 12;

      // Simple ring effect instead of chaotic sparks
      ctx.strokeStyle = '#ffcc44';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffcc44';
      ctx.shadowBlur = 8;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(player.x, player.y, 26, 0, Math.PI * 2);
      ctx.stroke();

    } else if (isBoosting) {
      // Boosting effect - subtle cyan
      playerColor = '#44ccff';
      glowColor = '#44ccff';
      glowIntensity = 10;

      // Simple boost ring
      ctx.strokeStyle = '#44ccff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#44ccff';
      ctx.shadowBlur = 8;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.arc(player.x, player.y, 24, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Subtle player glow
    ctx.fillStyle = `rgba(${glowColor === '#ff6666' ? '255,102,102' :
      glowColor === '#6699ff' ? '102,153,255' :
        glowColor === '#44ccff' ? '68,204,255' : '255,204,68'}, 0.15)`;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glowIntensity;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 22, 0, Math.PI * 2);
    ctx.fill();

    // Main player body with clean gradient
    const playerGradient = ctx.createRadialGradient(
      player.x - 4, player.y - 4, 0,
      player.x, player.y, 20
    );
    playerGradient.addColorStop(0, playerColor);
    playerGradient.addColorStop(0.8, playerColor);
    playerGradient.addColorStop(1, '#333333');

    ctx.fillStyle = playerGradient;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glowIntensity;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Clean player name
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 2;
    ctx.fillText(player.name, player.x, player.y - 30);

    // Clean direction indicator for local player
    if (isLocalPlayer) {
      ctx.strokeStyle = '#ffcc44';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffcc44';
      ctx.shadowBlur = 4;
      ctx.setLineDash([]);
      ctx.beginPath();
      const lookX = player.x + Math.cos(Math.atan2(gameState.ball.y - player.y, gameState.ball.x - player.x)) * 26;
      const lookY = player.y + Math.sin(Math.atan2(gameState.ball.y - player.y, gameState.ball.x - player.x)) * 26;
      ctx.moveTo(player.x, player.y);
      ctx.lineTo(lookX, lookY);
      ctx.stroke();
    }

    ctx.restore();
  });
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
  // Only continue render loop if we're actually in a playing game AND game screen is visible
  const gameScreenVisible = gameScreen.style.display === 'block';

  if (gameState.gameState === 'playing' && gameScreenVisible) {
    predictLocalPlayer(); // Predict movement for smooth controls
  }

  render();

  // Continue render loop only if game is playing AND game screen is visible
  if (gameState.gameState === 'playing' && gameScreenVisible) {
    requestAnimationFrame(renderLoop);
  }
}

// Lobby list management
function updateLobbyList(lobbies) {
  const lobbyList = document.getElementById('lobbyList');

  if (lobbies.length === 0) {
    lobbyList.innerHTML = `
      <div class="empty-state">
        <div class="pulse">🔍</div>
        <p>No active lobbies found</p>
        <small>Create a room to get started!</small>
      </div>
    `;
    return;
  }

  lobbyList.innerHTML = '';

  lobbies.forEach(lobby => {
    const lobbyItem = document.createElement('div');
    lobbyItem.className = `lobby-item ${lobby.playerCount >= 8 ? 'full' : ''}`;

    lobbyItem.innerHTML = `
      <div class="lobby-info">
        <div class="lobby-name">${lobby.id.toUpperCase()}</div>
        <div class="lobby-players">${lobby.playerCount}/8 players</div>
      </div>
      <button class="join-btn" ${lobby.playerCount >= 8 ? 'disabled' : ''}>
        ${lobby.playerCount >= 8 ? 'FULL' : 'JOIN'}
      </button>
    `;

    if (lobby.playerCount < 8) {
      const joinBtn = lobbyItem.querySelector('.join-btn');
      joinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
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

function requestOnlineMembers() {
  if (socket && connected) {
    socket.emit('requestOnlineMembers');
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
    const noDataMessage = '<div class="empty-state">No players have completed games yet</div>';
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

      // Get rank number styling
      let rankClass = '';
      if (rank === 1) rankClass = 'gold';
      else if (rank === 2) rankClass = 'silver';
      else if (rank === 3) rankClass = 'bronze';

      leaderboardItem.innerHTML = `
        <div class="rank-info">
          <div class="rank-number ${rankClass}">#${rank}</div>
          <div>
            <div class="player-name">${player.username.toUpperCase()}</div>
          </div>
        </div>
        <div class="player-stats">
          <div class="stat-line">${player.total_wins} wins</div>
          <div class="stat-line">${player.total_goals} goals</div>
        </div>
      `;

      list.appendChild(leaderboardItem);
    });
  });
}

function updateOnlineMembersDisplay(members) {
  if (!onlineMembersList) return;

  if (members.length === 0) {
    onlineMembersList.innerHTML = '<div class="empty-state">No online members</div>';
    return;
  }

  onlineMembersList.innerHTML = '';

  members.forEach(member => {
    const memberItem = document.createElement('div');
    memberItem.className = 'player-item';

    // Calculate how long ago they connected
    const connectedTime = new Date(member.connectedAt);
    const now = new Date();
    const timeDiff = Math.floor((now - connectedTime) / 1000); // seconds

    let timeAgo;
    if (timeDiff < 60) {
      timeAgo = 'just now';
    } else if (timeDiff < 3600) {
      timeAgo = `${Math.floor(timeDiff / 60)}m ago`;
    } else if (timeDiff < 86400) {
      timeAgo = `${Math.floor(timeDiff / 3600)}h ago`;
    } else {
      timeAgo = `${Math.floor(timeDiff / 86400)}d ago`;
    }

    memberItem.innerHTML = `
      <div class="player-info">
        <div class="status-indicator"></div>
        <div>
          <div class="player-name">${member.username.toUpperCase()}</div>
          <div class="player-status">Online ${timeAgo}</div>
        </div>
      </div>
    `;

    onlineMembersList.appendChild(memberItem);
  });
}

// Main menu functions
function initializeMainMenu() {
  createRoomBtn.addEventListener('click', handleCreateRoom);

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
  if (!connected || !currentRoomId) {
    alert('Not connected to server!');
    return;
  }

  // Only room owner can send everyone back to lobby
  const isOwner = gameState.ownerId === myPlayerId;
  if (isOwner) {
    socket.emit('returnToLobby', { roomId: currentRoomId });
  } else {
    alert('Only the room owner can return everyone to lobby!');
  }
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