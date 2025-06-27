// --- REQUIRED MODULES ---
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const Database = require('./db/database');

// --- CONFIGURATION ---
const port = process.env.PORT || 3000;
const OMDB_API_KEY = process.env.OMDB_API_KEY || '4dd7471d'; // Replace with your own key
const OMDB_BASE_URL = 'http://www.omdbapi.com/';

// --- INITIALIZATION ---
const app = express();

app.set('trust proxy', 1);

console.log('Express app configured with proxy trust');

const db = new Database();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? [
          `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`,
          /https:\/\/.*\.railway\.app$/,
          "https://app.strem.io", // Allow Stremio web app
          "https://web.stremio.com" // Allow Stremio web app
        ]
      : "*", // In development, allow all origins
    methods: ["GET", "POST"],
    credentials: true
  }
});

console.log('CORS configured for environment:', process.env.NODE_ENV || 'development');

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- HELPER FUNCTIONS ---

/**
 * Fetches movie or series information from the OMDB API.
 * @param {string} imdbId - The IMDB ID of the content.
 * @returns {Promise<object>} A promise resolving to the content's info.
 */
async function fetchOMDBInfo(imdbId) {
  const response = await fetch(`${OMDB_BASE_URL}?i=${imdbId}&apikey=${OMDB_API_KEY}`);
  const data = await response.json();
  if (data.Response === 'False') {
    throw new Error(data.Error || 'Movie/Series not found on OMDB');
  }
  return {
    title: data.Title,
    type: data.Type === 'series' ? 'series' : 'movie',
    poster: data.Poster !== 'N/A' ? data.Poster : null,
    genres: data.Genre !== 'N/A' ? data.Genre : null,
    year: data.Year,
    plot: data.Plot !== 'N/A' ? data.Plot : null,
    imdbRating: data.imdbRating !== 'N/A' ? data.imdbRating : null
  };
}

/**
 * Centralized logic to add content to a group, checking for duplicates.
 * @param {string} groupId - The ID of the group.
 * @param {string} imdbId - The IMDB ID of the content to add.
 * @returns {Promise<object>} An object containing the success status, message, and content info.
 */
async function addContentToGroup(groupId, imdbId) {
    console.log('=== addContentToGroup START ===');
    console.log('GroupId:', groupId);
    console.log('ImdbId:', imdbId);
    
    try {
        // Check if group exists
        const group = await db.getGroup(groupId);
        if (!group) {
            console.log('Group not found');
            throw new Error('Group not found');
        }
        console.log('Group found:', group.name);

        // Check for existing content
        console.log('Checking for existing content...');
        const existing = await db.getContentByImdbId(groupId, imdbId);
        console.log('Existing content check result:', existing);
        
        if (existing) {
            console.log('Content already exists - returning duplicate message');
            return { 
                success: false, 
                message: `"${existing.title}" is already in the group list.`, 
                info: null, 
                isDuplicate: true 
            };
        }

        // Fetch info from OMDB
        console.log('Fetching OMDB info...');
        const info = await fetchOMDBInfo(imdbId);
        console.log('OMDB info fetched:', { title: info.title, type: info.type });
        
        // Add to database
        console.log('Adding to database...');
        await db.addContent(groupId, imdbId, info.title, info.type, info.poster, info.genres);
        console.log('Successfully added to database');
        
        // Broadcast the update to the specific group's room
        console.log('Broadcasting to WebSocket room:', groupId);
        io.to(groupId).emit('new-content-added', info);
        
        const successResult = { 
            success: true, 
            message: `"${info.title}" was added to the group.`, 
            info: info, 
            isDuplicate: false 
        };
        
        console.log('=== addContentToGroup SUCCESS ===');
        console.log('Returning result:', successResult);
        return successResult;
        
    } catch (error) {
        console.error('=== addContentToGroup ERROR ===');
        console.error('Error details:', error);
        throw error;
    }
}

// --- SOCKET.IO REAL-TIME LOGIC ---
io.on('connection', (socket) => {
  console.log('A user connected via WebSocket:', socket.id);

  socket.on('join-group-room', (groupId) => {
    // Sockets join a "room" named after the groupId to receive targeted updates
    console.log(`Socket ${socket.id} is joining room: ${groupId}`);
    socket.join(groupId);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});


// --- WEB INTERFACE API ROUTES ---

// Serve the main web interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create a new group
app.post('/api/groups', async (req, res) => {
  console.log('=== CREATE GROUP REQUEST START ===');
  console.log('Request body:', req.body);
  
  try {
    const { name, password } = req.body;
    console.log('Extracted name:', name);
    console.log('Extracted password length:', password ? password.length : 'undefined');
    
    if (!name || !password) {
      console.log('Validation failed - missing name or password');
      return res.status(400).json({ error: 'Name and password are required' });
    }
    
    const groupId = uuidv4().substring(0, 8);
    console.log('Generated groupId:', groupId);
    
    console.log('Starting password hash...');
    const passwordHash = await bcrypt.hash(password, 10);
    console.log('Password hashed successfully, hash length:', passwordHash.length);
    
    console.log('Calling db.createGroup with:', { groupId, name, passwordHashLength: passwordHash.length });
    
    // Add a try-catch specifically around the database call
    try {
      const result = await db.createGroup(groupId, name, passwordHash);
      console.log('Database createGroup result:', result);
      
      // Verify the group was actually created by trying to fetch it
      console.log('Verifying group creation by fetching...');
      const createdGroup = await db.getGroup(groupId);
      console.log('Fetched group after creation:', createdGroup);
      
      if (!createdGroup) {
        throw new Error('Group was not found after creation - database insertion failed');
      }
      
    } catch (dbError) {
      console.error('DATABASE ERROR in createGroup:', dbError);
      console.error('Error details:', {
        message: dbError.message,
        code: dbError.code,
        errno: dbError.errno
      });
      throw dbError;
    }

    const addonUrl = `${req.protocol}://${req.get('host')}/${groupId}/manifest.json`;
    console.log('Generated addon URL:', addonUrl);
    
    const response = {
      groupId,
      name,
      addonUrl
    };
    
    console.log('Sending success response:', response);
    res.status(201).json(response);
    console.log('=== CREATE GROUP REQUEST SUCCESS ===');
    
  } catch (error) {
    console.error('=== CREATE GROUP REQUEST FAILED ===');
    console.error('Error creating group:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to create group: ' + error.message });
  }
});

// Join a group (verify password)
app.post('/api/groups/:id/join', async (req, res) => {
  try {
    const { password } = req.body;
    const group = await db.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const passwordMatch = await bcrypt.compare(password, group.password_hash);
    if (!passwordMatch) return res.status(401).json({ error: 'Invalid password' });

    res.json({
      groupId: group.id,
      name: group.name,
      addonUrl: `${req.protocol}://${req.get('host')}/${group.id}/manifest.json`
    });
  } catch (error) {
    console.error('Error joining group:', error);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

// Get content for a group
app.get('/api/groups/:id/content', async (req, res) => {
  try {
    const { type } = req.query;
    const content = await db.getContentByGroup(req.params.id, type);
    res.json(content);
  } catch (error) {
    console.error('Error fetching group content:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// Add content to a group (from web interface)
app.post('/api/groups/:id/content', async (req, res) => {
  try {
    const { imdbId } = req.body;
    const { id: groupId } = req.params;
    if (!imdbId || !imdbId.match(/^tt\d+$/)) {
      return res.status(400).json({ error: 'A valid IMDB ID is required (e.g., tt0111161)' });
    }
    
    const result = await addContentToGroup(groupId, imdbId);
    
    if (result.isDuplicate) {
        return res.status(409).json({ error: result.message }); // 409 Conflict
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding content:', error);
    if (error.message.includes('OMDB')) return res.status(404).json({ error: error.message });
    res.status(500).json({ error: 'Failed to add content to the group' });
  }
});

// Fetch movie/series info from OMDB (proxy for web UI)
app.get('/api/content/info/:imdbId', async (req, res) => {
  try {
    const { imdbId } = req.params;
    if (!imdbId.match(/^tt\d+$/)) {
      return res.status(400).json({ error: 'Invalid IMDB ID format.' });
    }
    const info = await fetchOMDBInfo(imdbId);
    res.json(info);
  } catch (error) {
    console.error('Error fetching OMDB info:', error);
    res.status(404).json({ error: error.message });
  }
});


// --- STREMIO ADDON ROUTES ---

// Stremio addon manifest
app.get('/:groupId/manifest.json', async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await db.getGroup(groupId);
    if (!group) return res.status(404).send('Addon not found.');

    // Check what content types exist in the group
    const allContent = await db.getContentByGroup(groupId);
    const hasMovies = allContent.some(item => item.type === 'movie');
    const hasSeries = allContent.some(item => item.type === 'series');
    
    // Build catalogs array based on what content actually exists
    const catalogs = [];
    
    if (hasMovies) {
      catalogs.push({ id: 'shared-movies', type: 'movie', name: 'Shared Movies' });
    }
    
    if (hasSeries) {
      catalogs.push({ id: 'shared-series', type: 'series', name: 'Shared Series' });
    }

    // If no content exists yet, show both catalogs so users can add content
    if (catalogs.length === 0) {
      catalogs.push({ id: 'shared-movies', type: 'movie', name: 'Shared Movies' });
      catalogs.push({ id: 'shared-series', type: 'series', name: 'Shared Series' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.json({
      id: `stremio.groups.${groupId}`,
      version: '1.3.0', // Incremented version for simplified catalogs
      name: `${group.name} - Group List`,
      description: `Shared movie and series catalog for the group: ${group.name}`,
      logo: `${req.protocol}://${req.get('host')}/logo.png`,
      resources: ['catalog', 'stream'],
      types: ['movie', 'series'],
      catalogs: catalogs
    });
  } catch (error) {
    console.error('Error serving manifest:', error);
    res.status(500).json({ error: 'Failed to serve manifest' });
  }
});

// Get group details (including catalog settings)
app.get('/api/groups/:id', async (req, res) => {
  try {
    const group = await db.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Don't return the password hash for security
    const { password_hash, ...groupData } = group;
    res.json(groupData);
  } catch (error) {
    console.error('Error fetching group:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// Update group catalog settings
app.put('/api/groups/:id/settings', async (req, res) => {
  try {
    const { catalog_settings } = req.body;
    const groupId = req.params.id;
    
    if (!catalog_settings) {
      return res.status(400).json({ error: 'Catalog settings are required' });
    }

    // Verify the group exists
    const group = await db.getGroup(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Update the settings
    await db.updateGroupCatalogSettings(groupId, catalog_settings);
    
    res.json({ 
      message: 'Catalog settings updated successfully',
      catalog_settings 
    });
  } catch (error) {
    console.error('Error updating catalog settings:', error);
    res.status(500).json({ error: 'Failed to update catalog settings' });
  }
});

// Stremio "Add to List" stream provider
app.get('/:groupId/stream/:type/:id.json', async (req, res) => {
  try {
    const { groupId, id } = req.params;
    const imdbId = id.split(':')[0];
    
    console.log(`Stream request: groupId=${groupId}, imdbId=${imdbId}`);
    
    const group = await db.getGroup(groupId);
    if (!group) {
      console.log('Group not found');
      return res.status(404).json({ streams: [] });
    }

    // Check if content already exists
    const existing = await db.getContentByImdbId(groupId, imdbId);
    if (existing) {
      console.log('Content already exists in group');
      return res.json({
        streams: [{
          name: `[${group.name}]`,
          title: `✅ Already in group: "${existing.title}"`,
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // Dummy URL since it's already added
        }]
      });
    }

    // The URL that will actually add the content
    const addActionUrl = `${req.protocol}://${req.get('host')}/api/groups/${groupId}/add-from-stremio/${imdbId}`;
    
    console.log('Providing add action URL:', addActionUrl);
    
    res.json({
      streams: [{
        name: `[${group.name}]`,
        title: '✨ Add to Group List',
        url: addActionUrl,
        behaviorHints: {
          notWebReady: true
        }
      }]
    });
  } catch (error) {
    console.error('Error serving stream:', error);
    res.status(500).json({ streams: [] });
  }
});

// Endpoint that Stremio's stream URL hits
app.get('/api/groups/:groupId/add-from-stremio/:imdbId', async (req, res) => {
  console.log('=== ADD FROM STREMIO REQUEST ===');
  console.log('GroupId:', req.params.groupId);
  console.log('ImdbId:', req.params.imdbId);
  console.log('Headers:', req.headers);
  console.log('User-Agent:', req.get('User-Agent'));
  
  try {
    const { groupId, imdbId } = req.params;
    const result = await addContentToGroup(groupId, imdbId);
    
    console.log('Add content result:', result);
    
    // Return a simple text response that Stremio can handle
    if (result.isDuplicate) {
      res.status(200).type('text/plain').send(`Already in list: ${result.message}`);
    } else {
      res.status(200).type('text/plain').send(`Added successfully: ${result.message}`);
    }
  } catch (error) {
    console.error('Error adding content from Stremio:', error);
    res.status(500).type('text/plain').send(`Error: ${error.message}`);
  }
});

// Stremio catalog provider
app.get('/:groupId/catalog/:type/:catalogId.json', async (req, res) => {
  try {
    const { groupId, catalogId } = req.params;
    let contentType = null;

    // Simple catalog logic - only movies and series
    if (catalogId === 'shared-movies') {
      contentType = 'movie';
    } else if (catalogId === 'shared-series') {
      contentType = 'series';
    } else {
      return res.status(404).json({ metas: [] });
    }
    
    const content = await db.getContentByGroup(groupId, contentType);
    const metas = content.map(item => ({
      id: item.imdb_id,
      type: item.type,
      name: item.title,
      poster: item.poster_url,
      genres: item.genres ? item.genres.split(',').map(g => g.trim()) : []
    }));

    res.setHeader('Content-Type', 'application/json');
    res.json({ metas });
  } catch (error) {
    console.error('Error serving catalog:', error);
    res.status(500).json({ error: 'Failed to serve catalog' });
  }
});

// --- HEALTH CHECK FOR RAILWAY ---
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

console.log('Health check endpoint configured at /health');

// --- SERVER START & SHUTDOWN ---
async function startServer() {
  try {
    console.log('Waiting for database initialization...');
    
    // Wait for database to be ready
    await db.waitForReady();
    
    console.log('Database is ready, starting HTTP server...');
    
    server.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Stremio Groups server running on port ${port}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      
      if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        console.log(`🌐 Public URL: https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
      } else {
        console.log(`🏠 Local URL: http://localhost:${port}`);
      }
      
      console.log(`💚 Health check: http://localhost:${port}/health`);
      console.log('=== SERVER READY TO ACCEPT REQUESTS ===');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  await db.close();
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  await db.close();
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

// Start the server
startServer();