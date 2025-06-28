const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
  console.log('=== DATABASE INITIALIZATION START ===');
  console.log('Platform:', process.platform);
  console.log('Current working directory:', process.cwd());
  console.log('__dirname:', __dirname);
  
  // Initialize as null first
  this.db = null;
  this.isReady = false;
  
  // Railway persistent storage path
  let dbDir;
  
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    // Use Railway volume for persistence
    dbDir = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    console.log('Using Railway volume for database persistence:', dbDir);
  } else if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
    // Fallback to app directory in Railway (but this might not persist)
    dbDir = path.join(process.cwd(), 'persistent-data');
    console.log('Railway environment detected, using persistent-data directory');
  } else {
    // Local development
    dbDir = path.join(__dirname, '..', 'db');
    console.log('Local environment detected');
  }
  
  console.log('Environment variables:');
  console.log('- NODE_ENV:', process.env.NODE_ENV || 'not set');
  console.log('- RAILWAY_ENVIRONMENT:', process.env.RAILWAY_ENVIRONMENT || 'not set');
  console.log('- RAILWAY_VOLUME_MOUNT_PATH:', process.env.RAILWAY_VOLUME_MOUNT_PATH || 'not set');
  console.log('- Database directory path:', dbDir);
  
  // Create database directory with better error handling
  try {
    if (!fs.existsSync(dbDir)) {
      console.log('Creating database directory...');
      fs.mkdirSync(dbDir, { recursive: true });
      console.log('Database directory created successfully');
    } else {
      console.log('Database directory already exists');
      
      // List contents of directory for debugging
      try {
        const files = fs.readdirSync(dbDir);
        console.log('Directory contents:', files);
      } catch (listError) {
        console.log('Could not list directory contents:', listError.message);
      }
    }
    
    // Test write permissions
    const testFile = path.join(dbDir, 'write-test.tmp');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log('Database directory is writable');
    
  } catch (error) {
    console.error('Error with database directory:', error);
    // Fallback to temp directory if main directory fails
    dbDir = '/tmp';
    console.log('Falling back to /tmp directory (WARNING: Data will not persist!)');
  }
  
  const dbPath = path.join(dbDir, 'stremio-groups.db'); // More specific name
  console.log('Final database file path:', dbPath);
  
  // Check if database file exists and is readable
  if (fs.existsSync(dbPath)) {
    try {
      const stats = fs.statSync(dbPath);
      console.log('Database file exists, size:', stats.size, 'bytes');
      console.log('Database last modified:', stats.mtime);
    } catch (error) {
      console.error('Error reading database file stats:', error);
    }
  } else {
    console.log('Database file does not exist, will be created');
  }
  
  // Create the database connection with Railway-specific options
  console.log('Creating SQLite database connection...');
  this.db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      console.error('Error opening database:', err);
      console.error('Error code:', err.code);
      console.error('Error errno:', err.errno);
      this.isReady = false;
      
      // Try alternative path if first attempt fails
      if (!err.message.includes('/tmp')) {
        console.log('Retrying with /tmp directory...');
        this.retryWithTempDir();
      }
    } else {
      console.log('Connected to SQLite database successfully');
      console.log('Database connection object created');
      
      // Test the connection with a simple query
      this.db.get("SELECT sqlite_version() as version", (testErr, row) => {
        if (testErr) {
          console.error('Database connection test failed:', testErr);
          this.isReady = false;
        } else {
          console.log('SQLite version:', row.version);
          console.log('Database connection test successful');
          
          // Enable Foreign Key enforcement
          this.db.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
            if (pragmaErr) {
              console.error("Failed to enable foreign keys:", pragmaErr);
              this.isReady = false;
            } else {
              console.log("Foreign key enforcement is on.");
              this.initTables();
            }
          });
        }
      });
    }
  });
}

  // Retry with temp directory if initial path fails
  retryWithTempDir() {
    console.log('=== RETRYING DATABASE WITH /tmp DIRECTORY ===');
    const tempDbPath = '/tmp/data.db';
    
    this.db = new sqlite3.Database(tempDbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
      if (err) {
        console.error('Failed to create database even in /tmp:', err);
        this.isReady = false;
      } else {
        console.log('Successfully created database in /tmp directory');
        
        this.db.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
          if (pragmaErr) {
            console.error("Failed to enable foreign keys:", pragmaErr);
            this.isReady = false;
          } else {
            console.log("Foreign key enforcement is on.");
            this.initTables();
          }
        });
      }
    });
  }

  // Add a method to wait for database readiness with longer timeout for Railway
  async waitForReady(timeoutMs = 30000) { // Increased timeout for Railway
    console.log('Waiting for database to be ready...');
    const startTime = Date.now();
    
    while (!this.isReady && (Date.now() - startTime) < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 200)); // Check every 200ms
    }
    
    if (!this.isReady) {
      console.error('Database failed to initialize within timeout period');
      console.error('Current state - db exists:', !!this.db, 'isReady:', this.isReady);
      throw new Error('Database failed to initialize within timeout period');
    }
    
    console.log('Database is ready!');
    return true;
  }

  initTables() {
    console.log('=== INITIALIZING TABLES ===');
    
    if (!this.db) {
      console.error('Cannot initialize tables - database connection is null');
      this.isReady = false;
      return;
    }
    
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

    let tablesCreated = 0;
    const totalTables = 2;

    this.db.run(groupsTable, (err) => {
      if (err) {
        console.error('Error creating groups table:', err);
        this.isReady = false;
      } else {
        console.log('Groups table created/verified successfully');
        tablesCreated++;
        if (tablesCreated === totalTables) {
          this.isReady = true;
          console.log('=== DATABASE INITIALIZATION COMPLETE ===');
        }
      }
    });
    
    this.db.run(contentTable, (err) => {
      if (err) {
        console.error('Error creating content table:', err);
        this.isReady = false;
      } else {
        console.log('Content table created/verified successfully');
        tablesCreated++;
        if (tablesCreated === totalTables) {
          this.isReady = true;
          console.log('=== DATABASE INITIALIZATION COMPLETE ===');
        }
      }
    });
  }

  // Add a check method for all database operations
  checkConnection() {
    if (!this.db) {
      throw new Error('Database connection is not initialized');
    }
    if (!this.isReady) {
      throw new Error('Database is not ready yet');
    }
  }

  // Rest of your methods remain the same...
  createGroup(id, name, passwordHash) {
    console.log('=== DATABASE createGroup START ===');
    console.log('Parameters:', { id, name, passwordHashLength: passwordHash ? passwordHash.length : 'undefined' });
    
    this.checkConnection();
    
    return new Promise((resolve, reject) => {
      const sql = 'INSERT INTO groups (id, name, password_hash) VALUES (?, ?, ?)';
      console.log('SQL query:', sql);
      console.log('About to execute db.run with individual parameters...');
      
      this.db.run(sql, id, name, passwordHash, function(err) {
        console.log('=== db.run callback executed ===');
        if (err) {
          console.error('Database error in createGroup:', err);
          reject(err);
        } else {
          console.log('Database insertion successful!');
          console.log('this.lastID:', this.lastID);
          console.log('this.changes:', this.changes);
          resolve(this.lastID);
        }
      });
    });
  }

  getGroup(id) {
    this.checkConnection();
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM groups WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  updateGroupCatalogSettings(id, settings) {
    this.checkConnection();
    return new Promise((resolve, reject) => {
      const sql = 'UPDATE groups SET catalog_settings = ? WHERE id = ?';
      this.db.run(sql, JSON.stringify(settings), id, function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  addContent(groupId, imdbId, title, type, posterUrl, genres) {
    this.checkConnection();
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO content (group_id, imdb_id, title, type, poster_url, genres) VALUES (?, ?, ?, ?, ?, ?)`;
      this.db.run(sql, groupId, imdbId, title, type, posterUrl, genres, function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  getContentByGroup(groupId, type = null) {
    this.checkConnection();
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
    this.checkConnection();
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM content WHERE group_id = ? AND imdb_id = ?';
      this.db.get(query, groupId, imdbId, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

getContentById(contentId, groupId) {
  console.log('=== DATABASE getContentById START ===');
  console.log('ContentId:', contentId, 'GroupId:', groupId);
  
  this.checkConnection();
  
  return new Promise((resolve, reject) => {
    const query = 'SELECT * FROM content WHERE id = ? AND group_id = ?';
    console.log('SQL Query:', query);
    
    this.db.get(query, contentId, groupId, (err, row) => {
      console.log('=== getContentById callback executed ===');
      if (err) {
        console.error('Database error in getContentById:', err);
        reject(err);
      } else {
        console.log('getContentById result:', row ? 'Found' : 'Not found');
        if (row) {
          console.log('Content details:', { title: row.title, type: row.type });
        }
        resolve(row);
      }
    });
  });
}


deleteContent(contentId, groupId) {
  console.log('=== DATABASE deleteContent START ===');
  console.log('ContentId:', contentId, 'GroupId:', groupId);
  
  this.checkConnection();
  
  return new Promise((resolve, reject) => {
    const query = 'DELETE FROM content WHERE id = ? AND group_id = ?';
    console.log('SQL Query:', query);
    
    this.db.run(query, contentId, groupId, function(err) {
      console.log('=== deleteContent callback executed ===');
      if (err) {
        console.error('Database error in deleteContent:', err);
        reject(err);
      } else {
        console.log('Delete operation completed');
        console.log('Rows affected:', this.changes);
        resolve(this.changes); // Returns number of deleted rows
      }
    });
  });
}

  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
            reject(err);
          } else {
            console.log('Database connection closed');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = Database;