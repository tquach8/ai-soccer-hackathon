const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

// Create database connection
const dbPath = path.join(__dirname, 'game.db');
const db = new sqlite3.Database(dbPath);

// JWT secret - in production, use environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize database tables
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          total_wins INTEGER DEFAULT 0,
          total_losses INTEGER DEFAULT 0,
          total_goals INTEGER DEFAULT 0,
          total_games INTEGER DEFAULT 0
        )
      `, (err) => {
        if (err) {
          console.error('Error creating users table:', err);
          reject(err);
        } else {
          console.log('✅ Users table ready');
          resolve();
        }
      });
    });
  });
}

// Register new user
function registerUser(username, password) {
  return new Promise(async (resolve, reject) => {
    try {
      // Check if user already exists
      db.get('SELECT username FROM users WHERE username = ?', [username], async (err, row) => {
        if (err) {
          reject({ error: 'Database error' });
          return;
        }

        if (row) {
          reject({ error: 'Username already exists' });
          return;
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Insert new user
        db.run(
          'INSERT INTO users (username, password_hash) VALUES (?, ?)',
          [username, passwordHash],
          function (err) {
            if (err) {
              reject({ error: 'Failed to create user' });
            } else {
              resolve({
                id: this.lastID,
                username: username,
                message: 'User created successfully'
              });
            }
          }
        );
      });
    } catch (error) {
      reject({ error: 'Server error' });
    }
  });
}

// Login user
function loginUser(username, password) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [username],
      async (err, row) => {
        if (err) {
          reject({ error: 'Database error' });
          return;
        }

        if (!row) {
          reject({ error: 'Invalid username or password' });
          return;
        }

        try {
          // Verify password
          const passwordMatch = await bcrypt.compare(password, row.password_hash);

          if (!passwordMatch) {
            reject({ error: 'Invalid username or password' });
            return;
          }

          // Generate JWT token
          const token = jwt.sign(
            { id: row.id, username: row.username },
            JWT_SECRET,
            { expiresIn: '24h' }
          );

          resolve({
            token: token,
            user: {
              id: row.id,
              username: row.username
            }
          });
        } catch (error) {
          reject({ error: 'Authentication error' });
        }
      }
    );
  });
}

// Verify JWT token
function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        reject({ error: 'Invalid or expired token' });
      } else {
        resolve(decoded);
      }
    });
  });
}

// Get user stats
function getUserStats(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT username, total_wins, total_losses, total_goals, total_games FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) {
          reject({ error: 'Database error' });
        } else if (!row) {
          reject({ error: 'User not found' });
        } else {
          resolve(row);
        }
      }
    );
  });
}

// Update user stats after game
function updateUserStats(userId, won, goals) {
  return new Promise((resolve, reject) => {
    const winIncrement = won ? 1 : 0;
    const lossIncrement = won ? 0 : 1;

    db.run(
      `UPDATE users SET 
       total_wins = total_wins + ?,
       total_losses = total_losses + ?,
       total_goals = total_goals + ?,
       total_games = total_games + 1
       WHERE id = ?`,
      [winIncrement, lossIncrement, goals, userId],
      function (err) {
        if (err) {
          reject({ error: 'Failed to update stats' });
        } else {
          resolve({ message: 'Stats updated successfully' });
        }
      }
    );
  });
}

// Update user stats by username after game
function updateUserStatsByUsername(username, won, goals) {
  return new Promise((resolve, reject) => {
    const winIncrement = won ? 1 : 0;
    const lossIncrement = won ? 0 : 1;

    db.run(
      `UPDATE users SET 
       total_wins = total_wins + ?,
       total_losses = total_losses + ?,
       total_goals = total_goals + ?,
       total_games = total_games + 1
       WHERE username = ?`,
      [winIncrement, lossIncrement, goals, username],
      function (err) {
        if (err) {
          reject({ error: 'Failed to update stats' });
        } else {
          if (this.changes === 0) {
            resolve({ message: 'User not found in database' });
          } else {
            resolve({ message: 'Stats updated successfully' });
          }
        }
      }
    );
  });
}

// Get leaderboard
function getLeaderboard(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT username, total_wins, total_losses, total_goals, total_games,
       ROUND(CAST(total_wins as FLOAT) / CASE WHEN total_games = 0 THEN 1 ELSE total_games END * 100, 1) as win_rate
       FROM users 
       WHERE total_games > 0
       ORDER BY total_wins DESC, win_rate DESC, total_goals DESC
       LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) {
          reject({ error: 'Database error' });
        } else {
          resolve(rows);
        }
      }
    );
  });
}

module.exports = {
  initializeDatabase,
  registerUser,
  loginUser,
  verifyToken,
  getUserStats,
  updateUserStats,
  updateUserStatsByUsername,
  getLeaderboard,
  db
}; 