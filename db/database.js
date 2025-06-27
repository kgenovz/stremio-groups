const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  cconstructor() {
  console.log('=== DATABASE INITIALIZATION START ===');
  
  // Railway-compatible database path
  // In production, Railway provides persistent storage in the app directory
  const dbDir = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'db')
    : path.join(__dirname, '..', 'db');
    
  console.log('Environment check:');
  console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');
  console.log('- RAILWAY_VOLUME_MOUNT_PATH:', process.env.RAILWAY_VOLUME_MOUNT_PATH || 'not set');
  console.log('- Database directory path:', dbDir);
  
  if (!fs.existsSync(dbDir)) {
    console.log('Creating database directory...');
    fs.mkdirSync(dbDir, { recursive: true });
  } else {
    console.log('Database directory already exists');
  }
  
  const dbPath = path.join(dbDir, 'data.db');
  console.log('Database file path:', dbPath);
  console.log('Database file exists:', fs.existsSync(dbPath));
  
  this.db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error opening database:', err);
    } else {
      console.log('Connected to SQLite database successfully');
      // Enable Foreign Key enforcement for data integrity
      this.db.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
        if (pragmaErr) console.error("Failed to enable foreign keys:", pragmaErr);
        else console.log("Foreign key enforcement is on.");
      });
      this.initTables();
    }
  });
}

  initTables() {
    console.log('=== INITIALIZING TABLES ===');
    const groupsTable = `
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        catalog_settings TEXT DEFAULT '{"movies":true,"series":true,"all":true}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const contentTable = `
      CREATE TABLE IF NOT EXISTS content (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        imdb_id TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('movie', 'series')),
        poster_url TEXT,
        genres TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        UNIQUE(group_id, imdb_id)
      )
    `;

    this.db.run(groupsTable, (err) => {
      if (err) console.error('Error creating groups table:', err);
      else console.log('Groups table created/verified successfully');
    });
    
    this.db.run(contentTable, (err) => {
      if (err) console.error('Error creating content table:', err);
      else console.log('Content table created/verified successfully');
    });
  }

  // --- Group operations ---
  
  /**
   * Creates a new group in the database.
   * @param {string} id The unique ID for the group.
   * @param {string} name The name of the group.
   * @param {string} passwordHash The hashed password for the group.
   * @returns {Promise<number>} A promise that resolves with the lastID of the inserted row.
   */
  createGroup(id, name, passwordHash) {
    console.log('=== DATABASE createGroup START ===');
    console.log('Parameters:', { id, name, passwordHashLength: passwordHash ? passwordHash.length : 'undefined' });
    
    return new Promise((resolve, reject) => {
      const sql = 'INSERT INTO groups (id, name, password_hash) VALUES (?, ?, ?)';
      console.log('SQL query:', sql);
      console.log('About to execute db.run with individual parameters...');
      
      this.db.run(sql, id, name, passwordHash, function(err) {
        console.log('=== db.run callback executed ===');
        if (err) {
          console.error('Database error in createGroup:', err);
          console.error('Error details:', {
            message: err.message,
            code: err.code,
            errno: err.errno
          });
          reject(err);
        } else {
          console.log('Database insertion successful!');
          console.log('this.lastID:', this.lastID);
          console.log('this.changes:', this.changes);
          resolve(this.lastID);
        }
        console.log('=== db.run callback finished ===');
      });
      
      console.log('db.run called, waiting for callback...');
    });
  }

  getGroup(id) {
    console.log('=== DATABASE getGroup START ===');
    console.log('Fetching group with id:', id);
    
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM groups WHERE id = ?', [id], (err, row) => {
        console.log('=== getGroup callback executed ===');
        if (err) {
          console.error('Error in getGroup:', err);
          reject(err);
        } else {
          console.log('getGroup result:', row);
          resolve(row);
        }
      });
    });
  }

  updateGroupCatalogSettings(id, settings) {
    return new Promise((resolve, reject) => {
      const sql = 'UPDATE groups SET catalog_settings = ? WHERE id = ?';
      this.db.run(sql, JSON.stringify(settings), id, function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  // --- Content operations ---
  
  addContent(groupId, imdbId, title, type, posterUrl, genres) {
    console.log('=== DATABASE addContent START ===');
    console.log('Parameters:', { groupId, imdbId, title, type, posterUrl, genres });
    
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO content (group_id, imdb_id, title, type, poster_url, genres) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      this.db.run(sql, groupId, imdbId, title, type, posterUrl, genres, function(err) {
        if (err) {
          console.error('Database error in addContent:', err);
          reject(err);
        } else {
          console.log('Content added successfully, lastID:', this.lastID);
          resolve(this.lastID);
        }
      });
    });
  }

  getContentByGroup(groupId, type = null) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM content WHERE group_id = ?';
      const params = [groupId];
      
      if (type && ['movie', 'series'].includes(type)) {
        query += ' AND type = ?';
        params.push(type);
      }
      
      query += ' ORDER BY added_at DESC';
      
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  getContentByImdbId(groupId, imdbId) {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM content WHERE group_id = ? AND imdb_id = ?';
      this.db.get(query, groupId, imdbId, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
          reject(err);
        } else {
          console.log('Database connection closed');
          resolve();
        }
      });
    });
  }
}

module.exports = Database;