// Authentication system
class AuthManager {
  constructor() {
    this.currentUser = null;
    this.token = localStorage.getItem('authToken');
    this.isLoginMode = true;
    this.isGuest = false;

    this.initializeElements();
    this.setupEventListeners();

    // Initially hide all lobby functionality
    this.hideAllLobbyFunctionality();

    // Check if user is already logged in
    if (this.token) {
      this.verifyToken();
    }
  }

  hideAllLobbyFunctionality() {
    // Hide main menu screen initially, show only auth screen with leaderboard
    if (this.mainMenuScreen) {
      this.mainMenuScreen.style.display = 'none';
    }

    // Hide specific authenticated features within main menu
    if (this.createRoomSection) {
      this.createRoomSection.style.display = 'none';
    }

    // Hide additional lobby elements until authentication (but keep leaderboard visible)
    if (this.playerNameSection) {
      this.playerNameSection.style.display = 'none';
    }
    if (this.lobbyBrowser) {
      this.lobbyBrowser.style.display = 'none';
    }
    // Hide main menu leaderboard by default
    if (this.mainLeaderboardSection) {
      this.mainLeaderboardSection.style.display = 'none';
    }
    // Auth screen leaderboard remains visible by default
  }

  hideAuthenticatedFeatures() {
    if (this.createRoomSection) {
      this.createRoomSection.style.display = 'none';
    }
  }

  initializeElements() {
    this.authScreen = document.getElementById('authScreen');
    this.authTitle = document.getElementById('authTitle');
    this.authForm = document.getElementById('authForm');
    this.authUsername = document.getElementById('authUsername');
    this.authPassword = document.getElementById('authPassword');
    this.authSubmitBtn = document.getElementById('authSubmitBtn');
    this.authSwitchText = document.getElementById('authSwitchText');
    this.authSwitchBtn = document.getElementById('authSwitchBtn');
    this.continueAsGuestBtn = document.getElementById('continueAsGuestBtn');
    this.authMessage = document.getElementById('authMessage');
    this.userInfo = document.getElementById('userInfo');
    this.userDisplay = document.getElementById('userDisplay');
    this.logoutBtn = document.getElementById('logoutBtn');
    this.mainMenuScreen = document.getElementById('mainMenuScreen');
    this.lobbyScreen = document.getElementById('lobbyScreen');
    this.gameScreen = document.getElementById('gameScreen');
    this.winningScreen = document.getElementById('winningScreen');
    this.createRoomSection = document.getElementById('createRoomSection');
    this.playerNameSection = document.querySelector('.player-name-section');
    this.lobbyBrowser = document.querySelector('.lobby-browser');
    this.leaderboardSection = document.querySelector('.leaderboard-section');
    this.mainLeaderboardSection = document.querySelector('#mainMenuScreen .leaderboard-section');
  }

  setupEventListeners() {
    this.authForm.addEventListener('submit', (e) => this.handleSubmit(e));
    this.authSwitchBtn.addEventListener('click', () => this.toggleMode());
    this.continueAsGuestBtn.addEventListener('click', () => this.continueAsGuest());
    this.logoutBtn.addEventListener('click', () => this.logout());
  }

  async handleSubmit(e) {
    e.preventDefault();

    const username = this.authUsername.value.trim();
    const password = this.authPassword.value;

    if (!username || !password) {
      this.showMessage('Please fill in all fields', 'error');
      return;
    }

    this.authSubmitBtn.disabled = true;
    this.authSubmitBtn.textContent = this.isLoginMode ? 'Logging in...' : 'Registering...';

    try {
      if (this.isLoginMode) {
        await this.login(username, password);
      } else {
        await this.register(username, password);
      }
    } catch (error) {
      console.error('Auth error:', error);
    } finally {
      this.authSubmitBtn.disabled = false;
      this.authSubmitBtn.textContent = this.isLoginMode ? 'Login' : 'Register';
    }
  }

  async login(username, password) {
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        this.token = data.token;
        this.currentUser = data.user;
        localStorage.setItem('authToken', this.token);
        this.showLoginSuccess();
      } else {
        this.showMessage(data.error || 'Login failed', 'error');
      }
    } catch (error) {
      this.showMessage('Network error. Please try again.', 'error');
    }
  }

  async register(username, password) {
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        this.showMessage('Account created successfully! Please login.', 'success');
        this.toggleMode(); // Switch to login mode
        this.authUsername.value = username; // Pre-fill username
        this.authPassword.value = ''; // Clear password
      } else {
        this.showMessage(data.error || 'Registration failed', 'error');
      }
    } catch (error) {
      this.showMessage('Network error. Please try again.', 'error');
    }
  }

  async verifyToken() {
    try {
      const response = await fetch('/api/me', {
        headers: {
          'Authorization': `Bearer ${this.token}`,
        },
      });

      if (response.ok) {
        const userData = await response.json();
        this.currentUser = userData;
        this.showLoginSuccess();
      } else {
        // Token is invalid
        this.logout();
      }
    } catch (error) {
      console.error('Token verification failed:', error);
      this.logout();
    }
  }

  showLoginSuccess() {
    this.userDisplay.textContent = `Welcome, ${this.currentUser.username}!`;
    this.userInfo.style.display = 'block';
    this.authScreen.style.display = 'none';
    this.mainMenuScreen.style.display = 'block';

    // Show authenticated features
    this.createRoomSection.style.display = 'block';

    // Show lobby functionality
    if (this.playerNameSection) {
      this.playerNameSection.style.display = 'block';
    }
    if (this.lobbyBrowser) {
      this.lobbyBrowser.style.display = 'block';
    }
    // Show leaderboard for authenticated users
    if (this.mainLeaderboardSection) {
      this.mainLeaderboardSection.style.display = 'block';
    }

    // Update player name input with authenticated username
    const playerNameInput = document.getElementById('playerNameInput');
    if (playerNameInput) {
      playerNameInput.value = this.currentUser.username;
      playerNameInput.disabled = true; // Prevent changing when logged in
    }
  }

  logout() {
    this.token = null;
    this.currentUser = null;
    this.isGuest = false;
    localStorage.removeItem('authToken');

    // Hide user info
    this.userInfo.style.display = 'none';

    // Hide ALL screens and show only auth screen
    this.mainMenuScreen.style.display = 'none';
    this.lobbyScreen.style.display = 'none';
    this.gameScreen.style.display = 'none';
    this.winningScreen.style.display = 'none';
    this.authScreen.style.display = 'block';

    // Leave room and disconnect from game if connected
    if (typeof leaveRoom === 'function') {
      leaveRoom();
    }

    // Reset game state
    if (typeof gameState !== 'undefined') {
      gameState.gameState = 'menu';
    }

    // Hide authenticated features
    this.createRoomSection.style.display = 'none';

    // Hide lobby functionality
    if (this.playerNameSection) {
      this.playerNameSection.style.display = 'none';
    }
    if (this.lobbyBrowser) {
      this.lobbyBrowser.style.display = 'none';
    }
    // Hide main menu leaderboard
    if (this.mainLeaderboardSection) {
      this.mainLeaderboardSection.style.display = 'none';
    }

    // Reset form
    this.authForm.reset();
    this.authMessage.innerHTML = '';

    // Re-enable player name input
    const playerNameInput = document.getElementById('playerNameInput');
    if (playerNameInput) {
      playerNameInput.disabled = false;
      playerNameInput.value = 'Player';
    }
  }

  toggleMode() {
    this.isLoginMode = !this.isLoginMode;

    if (this.isLoginMode) {
      this.authTitle.textContent = 'Welcome Back';
      this.authSubmitBtn.textContent = 'Login';
      this.authSwitchText.textContent = "Don't have an account?";
      this.authSwitchBtn.textContent = 'Register';
    } else {
      this.authTitle.textContent = 'Create Account';
      this.authSubmitBtn.textContent = 'Register';
      this.authSwitchText.textContent = 'Already have an account?';
      this.authSwitchBtn.textContent = 'Login';
    }

    this.authMessage.innerHTML = '';
    this.authPassword.value = '';
  }

  showMessage(message, type) {
    this.authMessage.innerHTML = `<div class="${type}-message">${message}</div>`;
  }

  continueAsGuest() {
    this.isGuest = true;
    this.authScreen.style.display = 'none';
    this.mainMenuScreen.style.display = 'block';

    // Hide authenticated features for guests
    this.createRoomSection.style.display = 'none';

    // Show lobby functionality for guests
    if (this.playerNameSection) {
      this.playerNameSection.style.display = 'block';
    }
    if (this.lobbyBrowser) {
      this.lobbyBrowser.style.display = 'block';
    }
    // Hide main menu leaderboard for guests (they saw it on auth screen)
    if (this.mainLeaderboardSection) {
      this.mainLeaderboardSection.style.display = 'none';
    }

    // Enable player name input for guests
    const playerNameInput = document.getElementById('playerNameInput');
    if (playerNameInput) {
      playerNameInput.disabled = false;
      playerNameInput.value = 'Player';
    }
  }

  // Get current user data for game integration
  getCurrentUser() {
    return this.currentUser;
  }

  // Get auth token for API requests
  getToken() {
    return this.token;
  }

  // Check if user is authenticated
  isAuthenticated() {
    return this.token && this.currentUser;
  }

  // Check if user is playing as guest
  isPlayingAsGuest() {
    return this.isGuest;
  }

  // Hide auth screen (called when guest joins lobby)
  hideAuthScreen() {
    if (this.isGuest && this.authScreen.style.display !== 'none') {
      this.authScreen.style.display = 'none';
    }
  }

  // Show auth screen (called when returning to main menu) - Modified to not hide main menu for guests
  showAuthScreenIfGuest() {
    // Only show auth screen if user is not authenticated and not a guest who has already accessed the lobby
    if (!this.isAuthenticated() && !this.isGuest) {
      this.authScreen.style.display = 'block';
      this.mainMenuScreen.style.display = 'none';
    }
  }
}

// Initialize authentication when page loads
let authManager;
document.addEventListener('DOMContentLoaded', () => {
  authManager = new AuthManager();
}); 