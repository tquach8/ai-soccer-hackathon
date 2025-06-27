// Game setup
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

// Game constants
const PLAYER_SPEED = 1.5;
const BOOST_SPEED = 2.2; // Reduced from 3 - smaller advantage
const BALL_FRICTION = 0.995; // Increased from 0.99 - ball slows down faster
const WALL_BOUNCE = 0.3;
const BOOST_DRAIN_RATE = 1; // per frame while boosting
const BOOST_REGEN_RATE = 0.05; // per frame when not boosting (much slower)
const HIT_FORCE = 0.6; // Much gentler base hit force
const BOOST_HIT_MULTIPLIER = 1.2; // Further reduced for controlled gameplay

// Game state
const keys = {};
let gameRunning = false; // Start with game stopped
let gameState = 'lobby'; // 'lobby' or 'playing'
let playerScore = 0;
let opponentScore = 0;

// Lobby state
let teams = {
  red: [],
  blue: []
};
let currentPlayer = null;

// Player object
const player = {
  x: 100,
  y: canvas.height / 2,
  radius: 20,
  boost: 100,
  color: '#44aaff',
  boostColor: '#ffaa44'
};

// Ball object
const ball = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  vx: 0,
  vy: 0,
  radius: 15,
  color: '#ffffff',
  trail: []
};

// Goals
const goals = {
  left: { x: 0, y: canvas.height / 2 - 60, width: 20, height: 120 },
  right: { x: canvas.width - 20, y: canvas.height / 2 - 60, width: 20, height: 120 }
};

// Boost pads in corners
const boostPads = [
  { x: 50, y: 50, radius: 20, active: true, cooldown: 0, maxCooldown: 180 }, // top-left
  { x: canvas.width - 50, y: 50, radius: 20, active: true, cooldown: 0, maxCooldown: 180 }, // top-right
  { x: 50, y: canvas.height - 50, radius: 20, active: true, cooldown: 0, maxCooldown: 180 }, // bottom-left
  { x: canvas.width - 50, y: canvas.height - 50, radius: 20, active: true, cooldown: 0, maxCooldown: 180 } // bottom-right
];

// Input handling
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  keys[key] = true;

  // Prevent default browser behaviors for game keys
  if (key === ' ' || key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  keys[key] = false;

  // Prevent default browser behaviors for game keys
  if (key === ' ' || key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
    e.preventDefault();
  }
});

// Utility functions
function distance(obj1, obj2) {
  return Math.sqrt((obj1.x - obj2.x) ** 2 + (obj1.y - obj2.y) ** 2);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Update player
function updatePlayer() {
  let speed = PLAYER_SPEED;
  let isBoosting = keys['shift'] && player.boost > 0;

  // Handle boost
  if (isBoosting) {
    speed = BOOST_SPEED;
    player.boost = Math.max(0, player.boost - BOOST_DRAIN_RATE);
  } else {
    player.boost = Math.min(100, player.boost + BOOST_REGEN_RATE);
  }

  // Movement
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

  // Apply movement
  player.x += dx * speed;
  player.y += dy * speed;

  // Keep player mostly in bounds (allow slight out-of-bounds movement)
  const outOfBoundsBuffer = player.radius * 0.6; // Allow 60% of radius outside
  player.x = clamp(player.x, -outOfBoundsBuffer, canvas.width + outOfBoundsBuffer);
  player.y = clamp(player.y, -outOfBoundsBuffer, canvas.height + outOfBoundsBuffer);

  // Ball hitting
  if (keys[' ']) {
    hitBall(isBoosting);
  }

  // Check boost pad collisions
  checkBoostPadCollisions();
}

// Hit the ball
function hitBall(boosted = false) {
  const dist = distance(player, ball);
  const hitRange = player.radius + ball.radius + 10;

  if (dist < hitRange) {
    // Calculate hit direction
    const angle = Math.atan2(ball.y - player.y, ball.x - player.x);
    let force = HIT_FORCE;

    if (boosted && player.boost > 15) {
      force *= BOOST_HIT_MULTIPLIER;
      player.boost -= 15; // Extra boost cost for power hit
    }

    ball.vx += Math.cos(angle) * force;
    ball.vy += Math.sin(angle) * force;

    // Add some randomness for fun
    ball.vx += (Math.random() - 0.5) * 2;
    ball.vy += (Math.random() - 0.5) * 2;
  }
}

// Check boost pad collisions
function checkBoostPadCollisions() {
  boostPads.forEach(pad => {
    if (pad.active) {
      const dist = distance(player, pad);
      if (dist < player.radius + pad.radius) {
        // Give boost and deactivate pad
        player.boost = Math.min(100, player.boost + 25);
        pad.active = false;
        pad.cooldown = pad.maxCooldown;
      }
    }
  });
}

// Update boost pads
function updateBoostPads() {
  boostPads.forEach(pad => {
    if (!pad.active) {
      pad.cooldown--;
      if (pad.cooldown <= 0) {
        pad.active = true;
      }
    }
  });
}

// Handle player-ball collision
function handlePlayerBallCollision() {
  const dist = distance(player, ball);
  const minDistance = player.radius + ball.radius;

  if (dist < minDistance) {
    // Calculate collision normal
    const angle = Math.atan2(ball.y - player.y, ball.x - player.x);

    // Separate the objects
    const overlap = minDistance - dist;
    const separateX = Math.cos(angle) * overlap * 0.5;
    const separateY = Math.sin(angle) * overlap * 0.5;

    ball.x += separateX;
    ball.y += separateY;
    player.x -= separateX;
    player.y -= separateY;

    // Minimal push force - ball should stick to player
    let pushForce = 0.02;
    const isBoosting = keys['shift'] && player.boost > 0;
    if (isBoosting) {
      pushForce = 0.05;
    }

    // Add player velocity influence (minimal)
    let playerVx = 0, playerVy = 0;
    if (keys['a']) playerVx -= 1;
    if (keys['d']) playerVx += 1;
    if (keys['w']) playerVy -= 1;
    if (keys['s']) playerVy += 1;

    // Apply minimal force - ball should follow player movement
    ball.vx += Math.cos(angle) * pushForce + playerVx * 0.02;
    ball.vy += Math.sin(angle) * pushForce + playerVy * 0.02;

    // Keep player in bounds after collision
    player.x = clamp(player.x, player.radius, canvas.width - player.radius);
    player.y = clamp(player.y, player.radius, canvas.height - player.radius);
  }
}

// Check for goals
function checkGoals() {
  // Left goal (opponent scores)
  if (ball.x <= goals.left.x + goals.left.width &&
    ball.y >= goals.left.y &&
    ball.y <= goals.left.y + goals.left.height) {
    opponentScore++;
    resetBall();
    return true;
  }

  // Right goal (player scores)
  if (ball.x >= goals.right.x &&
    ball.y >= goals.right.y &&
    ball.y <= goals.right.y + goals.right.height) {
    playerScore++;
    resetBall();
    return true;
  }

  return false;
}

// Reset ball to center after goal
function resetBall() {
  ball.x = canvas.width / 2;
  ball.y = canvas.height / 2;
  ball.vx = 0;
  ball.vy = 0;
  ball.trail = [];

  // Reset player position too
  resetPlayer();
}

// Initialize/reset player
function resetPlayer() {
  player.x = 100;
  player.y = canvas.height / 2;
  player.boost = 100;
}

// Update ball physics
function updateBall() {
  // Handle player collision first
  handlePlayerBallCollision();

  // Apply velocity
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Apply friction
  ball.vx *= BALL_FRICTION;
  ball.vy *= BALL_FRICTION;

  // Check for goals before wall collisions
  if (checkGoals()) {
    return; // Ball was reset, skip other physics
  }

  // Wall collisions
  if (ball.x - ball.radius <= 0 || ball.x + ball.radius >= canvas.width) {
    ball.vx *= -WALL_BOUNCE;
    ball.x = clamp(ball.x, ball.radius, canvas.width - ball.radius);
  }

  if (ball.y - ball.radius <= 0 || ball.y + ball.radius >= canvas.height) {
    ball.vy *= -WALL_BOUNCE;
    ball.y = clamp(ball.y, ball.radius, canvas.height - ball.radius);
  }

  // Update trail for visual effect
  ball.trail.push({ x: ball.x, y: ball.y });
  if (ball.trail.length > 15) {
    ball.trail.shift();
  }
}

// Render everything
function render() {
  // Clear canvas with modern gradient background
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#1e3a1e');
  gradient.addColorStop(0.5, '#2d4a2d');
  gradient.addColorStop(1, '#1e3a1e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw modern field lines with glassmorphism effect
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.shadowColor = 'rgba(255, 255, 255, 0.3)';
  ctx.shadowBlur = 5;

  // Center line
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.stroke();

  // Center circle
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, 80, 0, Math.PI * 2);
  ctx.stroke();

  // Draw corner arcs for style
  const cornerRadius = 30;
  ctx.beginPath();
  ctx.arc(0, 0, cornerRadius, 0, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(canvas.width, 0, cornerRadius, Math.PI / 2, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, canvas.height, cornerRadius, -Math.PI / 2, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(canvas.width, canvas.height, cornerRadius, Math.PI, -Math.PI / 2);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  // Draw modern goals with gradient and glow effects
  // Left goal - Red team
  const redGradient = ctx.createLinearGradient(goals.left.x, goals.left.y, goals.left.x + goals.left.width, goals.left.y + goals.left.height);
  redGradient.addColorStop(0, '#e74c3c');
  redGradient.addColorStop(0.5, '#c0392b');
  redGradient.addColorStop(1, '#a93226');
  ctx.fillStyle = redGradient;
  ctx.shadowColor = '#e74c3c';
  ctx.shadowBlur = 15;
  ctx.fillRect(goals.left.x, goals.left.y, goals.left.width, goals.left.height);

  // Right goal - Blue team  
  const blueGradient = ctx.createLinearGradient(goals.right.x, goals.right.y, goals.right.x + goals.right.width, goals.right.y + goals.right.height);
  blueGradient.addColorStop(0, '#3498db');
  blueGradient.addColorStop(0.5, '#2980b9');
  blueGradient.addColorStop(1, '#1f4e79');
  ctx.fillStyle = blueGradient;
  ctx.shadowColor = '#3498db';
  ctx.shadowBlur = 15;
  ctx.fillRect(goals.right.x, goals.right.y, goals.right.width, goals.right.height);

  ctx.shadowBlur = 0;

  // Draw modern boost pads with glassmorphism effect
  boostPads.forEach(pad => {
    if (pad.active) {
      // Active boost pad - modern glowing design
      const boostGradient = ctx.createRadialGradient(pad.x, pad.y, 0, pad.x, pad.y, pad.radius);
      boostGradient.addColorStop(0, 'rgba(46, 204, 113, 0.9)');
      boostGradient.addColorStop(0.7, 'rgba(39, 174, 96, 0.7)');
      boostGradient.addColorStop(1, 'rgba(39, 174, 96, 0.3)');
      ctx.fillStyle = boostGradient;
      ctx.shadowColor = '#2ecc71';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pad.radius, 0, Math.PI * 2);
      ctx.fill();

      // Add inner highlight
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pad.radius * 0.6, 0, Math.PI * 2);
      ctx.fill();

      // Add "⚡" symbol instead of "B"
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px Arial';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#2ecc71';
      ctx.shadowBlur = 5;
      ctx.fillText('⚡', pad.x, pad.y + 6);
      ctx.shadowBlur = 0;
    } else {
      // Inactive boost pad - modern cooldown design
      const inactiveGradient = ctx.createRadialGradient(pad.x, pad.y, 0, pad.x, pad.y, pad.radius);
      inactiveGradient.addColorStop(0, 'rgba(108, 117, 125, 0.8)');
      inactiveGradient.addColorStop(0.7, 'rgba(73, 80, 87, 0.6)');
      inactiveGradient.addColorStop(1, 'rgba(73, 80, 87, 0.3)');
      ctx.fillStyle = inactiveGradient;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pad.radius, 0, Math.PI * 2);
      ctx.fill();

      // Show cooldown progress with modern arc
      const progress = 1 - (pad.cooldown / pad.maxCooldown);
      const progressGradient = ctx.createRadialGradient(pad.x, pad.y, 0, pad.x, pad.y, pad.radius);
      progressGradient.addColorStop(0, 'rgba(46, 204, 113, 0.8)');
      progressGradient.addColorStop(1, 'rgba(39, 174, 96, 0.5)');
      ctx.fillStyle = progressGradient;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pad.radius, -Math.PI / 2, -Math.PI / 2 + (progress * Math.PI * 2));
      ctx.lineTo(pad.x, pad.y);
      ctx.fill();

      // Add faded symbol
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('⚡', pad.x, pad.y + 5);
    }
  });

  // Draw modern ball trail with gradient
  ball.trail.forEach((point, index) => {
    const alpha = (index / ball.trail.length) * 0.6;
    const trailGradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, ball.radius * alpha);
    trailGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    trailGradient.addColorStop(0.5, `rgba(255, 255, 255, ${alpha * 0.7})`);
    trailGradient.addColorStop(1, `rgba(255, 255, 255, 0)`);
    ctx.fillStyle = trailGradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, ball.radius * alpha * 0.8, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw modern ball with gradient and glow
  const ballGradient = ctx.createRadialGradient(ball.x - ball.radius * 0.3, ball.y - ball.radius * 0.3, 0, ball.x, ball.y, ball.radius);
  ballGradient.addColorStop(0, '#ffffff');
  ballGradient.addColorStop(0.4, '#f8f9fa');
  ballGradient.addColorStop(0.8, '#e9ecef');
  ballGradient.addColorStop(1, '#dee2e6');

  const speed = Math.sqrt(ball.vx ** 2 + ball.vy ** 2);

  // Add glow effect based on speed
  if (speed > 3) {
    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = Math.min(speed * 2, 25);
  }

  ctx.fillStyle = ballGradient;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  // Add inner highlight for 3D effect
  ctx.shadowBlur = 0;
  const highlightGradient = ctx.createRadialGradient(ball.x - ball.radius * 0.4, ball.y - ball.radius * 0.4, 0, ball.x - ball.radius * 0.2, ball.y - ball.radius * 0.2, ball.radius * 0.6);
  highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
  highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = highlightGradient;
  ctx.beginPath();
  ctx.arc(ball.x - ball.radius * 0.3, ball.y - ball.radius * 0.3, ball.radius * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Draw modern player with gradient effects
  const isBoosting = keys['shift'] && player.boost > 0;
  const isKicking = keys[' '];

  // Create base player gradient
  const playerGradient = ctx.createRadialGradient(
    player.x - player.radius * 0.3,
    player.y - player.radius * 0.3,
    0,
    player.x,
    player.y,
    player.radius
  );

  if (isKicking) {
    // Kicking effect - bright energetic colors
    playerGradient.addColorStop(0, '#ffffff');
    playerGradient.addColorStop(0.3, '#fff3cd');
    playerGradient.addColorStop(0.7, '#ffc107');
    playerGradient.addColorStop(1, '#ff8f00');
    ctx.shadowColor = '#ffc107';
    ctx.shadowBlur = 25;
  } else if (isBoosting) {
    // Boosting effect - orange/yellow energy
    playerGradient.addColorStop(0, '#fff3e0');
    playerGradient.addColorStop(0.3, '#ffcc02');
    playerGradient.addColorStop(0.7, '#ff9800');
    playerGradient.addColorStop(1, '#f57c00');
    ctx.shadowColor = '#ff9800';
    ctx.shadowBlur = 20;
  } else {
    // Normal state - blue gradient
    playerGradient.addColorStop(0, '#e3f2fd');
    playerGradient.addColorStop(0.3, '#64b5f6');
    playerGradient.addColorStop(0.7, '#2196f3');
    playerGradient.addColorStop(1, '#1976d2');
  }

  // Draw player circle
  ctx.fillStyle = playerGradient;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();

  // Add inner highlight for 3D effect
  ctx.shadowBlur = 0;
  const playerHighlight = ctx.createRadialGradient(
    player.x - player.radius * 0.4,
    player.y - player.radius * 0.4,
    0,
    player.x - player.radius * 0.2,
    player.y - player.radius * 0.2,
    player.radius * 0.6
  );
  playerHighlight.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
  playerHighlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = playerHighlight;
  ctx.beginPath();
  ctx.arc(player.x - player.radius * 0.3, player.y - player.radius * 0.3, player.radius * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Draw modern direction indicator
  const angle = Math.atan2(ball.y - player.y, ball.x - player.x);
  const indicatorLength = player.radius + 8;
  const lookX = player.x + Math.cos(angle) * indicatorLength;
  const lookY = player.y + Math.sin(angle) * indicatorLength;

  // Create gradient for direction line
  const lineGradient = ctx.createLinearGradient(player.x, player.y, lookX, lookY);
  lineGradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
  lineGradient.addColorStop(1, 'rgba(255, 255, 255, 0.8)');

  ctx.strokeStyle = lineGradient;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.moveTo(player.x, player.y);
  ctx.lineTo(lookX, lookY);
  ctx.stroke();

  // Add arrowhead
  const arrowSize = 6;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.moveTo(lookX, lookY);
  ctx.lineTo(
    lookX - arrowSize * Math.cos(angle - Math.PI / 6),
    lookY - arrowSize * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    lookX - arrowSize * Math.cos(angle + Math.PI / 6),
    lookY - arrowSize * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
}

// Update boost UI
function updateBoostUI() {
  const percentage = Math.round(player.boost);
  boostFill.style.width = percentage + '%';
  boostText.textContent = percentage + '%';
}

// Update score display
function updateScoreUI() {
  leftTeamScoreElement.textContent = playerScore;
  rightTeamScoreElement.textContent = opponentScore;
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

  updateLobbyUI();
}

function handleSlotClick(event) {
  const slot = event.currentTarget;
  const team = slot.dataset.team;
  const slotIndex = parseInt(slot.dataset.slot);

  if (slot.classList.contains('empty')) {
    // Join this team
    const playerName = `Player ${teams.red.length + teams.blue.length + 1}`;
    teams[team].push({ name: playerName, slot: slotIndex });
    currentPlayer = { team, name: playerName };
    updateLobbyUI();
  } else {
    // Leave this team (if it's the current player)
    const playerInSlot = teams[team].find(p => p.slot === slotIndex);
    if (playerInSlot && currentPlayer && playerInSlot.name === currentPlayer.name) {
      teams[team] = teams[team].filter(p => p.slot !== slotIndex);
      currentPlayer = null;
      updateLobbyUI();
    }
  }
}

function updateLobbyUI() {
  // Update all slots
  document.querySelectorAll('.player-slot').forEach(slot => {
    const team = slot.dataset.team;
    const slotIndex = parseInt(slot.dataset.slot);
    const player = teams[team].find(p => p.slot === slotIndex);

    if (player) {
      slot.classList.remove('empty');
      slot.classList.add('filled');
      slot.querySelector('.slot-text').textContent = player.name;
    } else {
      slot.classList.remove('filled');
      slot.classList.add('empty');
      slot.querySelector('.slot-text').textContent = 'Click to Join';
    }
  });

  // Update start button
  const hasPlayers = teams.red.length > 0 || teams.blue.length > 0;
  startGameBtn.disabled = !hasPlayers;

  const lobbyInfo = document.querySelector('.lobby-info');
  if (hasPlayers) {
    lobbyInfo.textContent = 'Ready to play!';
  } else {
    lobbyInfo.textContent = 'Select teams to begin playing!';
  }
}

function startGame() {
  gameState = 'playing';
  gameRunning = true;

  // Setup team colors and labels
  leftTeamLabelElement.textContent = 'Red';
  rightTeamLabelElement.textContent = 'Blue';

  // Reset scores
  playerScore = 0;
  opponentScore = 0;

  // Show game screen, hide lobby
  lobbyScreen.style.display = 'none';
  gameScreen.style.display = 'block';

  // Reset game state
  resetBall();
  resetPlayer();

  // Start game loop
  gameLoop();
}

function backToLobby() {
  gameState = 'lobby';
  gameRunning = false;

  // Show lobby screen, hide game
  lobbyScreen.style.display = 'block';
  gameScreen.style.display = 'none';
}

function showScreen(screenName) {
  lobbyScreen.style.display = screenName === 'lobby' ? 'block' : 'none';
  gameScreen.style.display = screenName === 'game' ? 'block' : 'none';
}

// Main game loop
function gameLoop() {
  if (!gameRunning || gameState !== 'playing') return;

  updatePlayer();
  updateBall();
  updateBoostPads();
  render();
  updateBoostUI();
  updateScoreUI();

  requestAnimationFrame(gameLoop);
}

// Initialize the game
function init() {
  console.log('Blitz Ball starting...');
  initializeLobby();

  // Show lobby screen initially
  showScreen('lobby');
}

// Start the initialization when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
} 