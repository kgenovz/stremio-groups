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
const OMDB_API_KEY = process.env.OMDB_API_KEY || '4dd7471d'; // Hardcoded for development, **REPLACE IN PRODUCTION** 
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
            : "*", // Allow all origins in development
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

function generateSuccessPageHTML(group, params, movies, series, req) {
    const { added, duplicate, existing, error } = params;

    let statusMessage = '';
    let statusClass = '';
    let statusEmoji = '';

    if (error) {
        statusMessage = `Failed to add content: ${decodeURIComponent(error)}`;
        statusClass = 'error';
        statusEmoji = '❌';
    } else if (duplicate === 'true' || existing) {
        const title = existing ? decodeURIComponent(existing) : 'content';
        statusMessage = `"${title}"\nis already in your group list`;
        statusClass = 'warning';
        statusEmoji = '⚠️';
    } else if (added) {
        statusMessage = `"${decodeURIComponent(added)}"\nwas successfully added to your group!`;
        statusClass = 'success';
        statusEmoji = '✅';
    } else {
        statusMessage = 'Welcome to your group page!';
        statusClass = 'info';
        statusEmoji = '🎬';
    }

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Success - ${group.name}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
            padding: 1rem;
        }
        .container { max-width: 800px; margin: 0 auto; }
        
        .success-header {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 16px;
            padding: 2rem;
            text-align: center;
            margin-bottom: 2rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
        }
        
        .status-emoji {
            font-size: 4rem;
            margin-bottom: 1rem;
            display: block;
        }
        
        .status-message {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 1rem;
        }
        
        .status-message.success { color: #28a745; }
        .status-message.warning { color: #ffc107; }
        .status-message.error { color: #dc3545; }
        .status-message.info { color: #17a2b8; }
        
        .group-info {
            background: rgba(255, 255, 255, 0.9);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
            text-align: center;
        }
        
        .group-name {
            font-size: 2rem;
            font-weight: 700;
            color: #333;
            margin-bottom: 0.5rem;
        }
        
        .group-id {
            font-family: 'Courier New', monospace;
            font-size: 1.5rem;
            font-weight: 600;
            background: #667eea;
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 8px;
            display: inline-block;
            letter-spacing: 2px;
        }
        
        .content-section {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .content-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1rem;
            font-size: 1.2rem;
            font-weight: 600;
            color: #555;
        }
        
        .content-count {
            background: #667eea;
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: 700;
        }
        
        .content-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }
        
        .content-item {
            text-align: center;
            background: #f8f9fa;
            border-radius: 8px;
            padding: 1rem 0.5rem;
            transition: transform 0.2s;
        }
        
        .content-item:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .content-poster {
            width: 80px;
            height: 120px;
            object-fit: cover;
            border-radius: 6px;
            margin-bottom: 0.5rem;
        }
        
        .content-title {
            font-size: 0.9rem;
            font-weight: 600;
            line-height: 1.2;
            margin-bottom: 0.25rem;
        }
        
        .content-type {
            font-size: 0.7rem;
            text-transform: uppercase;
            font-weight: bold;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            color: white;
        }
        
        .content-type.movie { background: #667eea; }
        .content-type.series { background: #28a745; }
        
        .empty-content {
            text-align: center;
            color: #666;
            font-style: italic;
            padding: 2rem;
        }
        
        .back-button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            padding: 1rem 2rem;
            border-radius: 8px;
            font-weight: 600;
            margin-top: 1rem;
            transition: transform 0.2s;
        }
        
        .back-button:hover {
            transform: translateY(-2px);
            text-decoration: none;
            color: white;
        }
        
        @media (max-width: 768px) {
            .group-name { font-size: 1.5rem; }
            .group-id { font-size: 1.2rem; letter-spacing: 1px; }
            .content-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.75rem; }
            .content-poster { width: 60px; height: 90px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-header">
            <span class="status-emoji">${statusEmoji}</span>
            <div class="status-message ${statusClass}">${statusMessage}</div>
            <a href="${req.protocol}://${req.get('host')}" class="back-button">🏠 Go to Main Site</a>
        </div>
        
        <div class="group-info">
            <div class="group-name">${group.name}</div>
            <div class="group-id">${group.id}</div>
        </div>
        
        ${movies.length > 0 ? `
        <div class="content-section">
            <div class="content-header">
                🎬 Movies <span class="content-count">${movies.length}</span>
            </div>
            <div class="content-grid">
                ${movies.map(movie => `
                    <div class="content-item">
                        <img class="content-poster" src="${movie.poster_url || 'https://via.placeholder.com/80x120.png?text=No+Poster'}" alt="${movie.title}">
                        <div class="content-title">${movie.title}</div>
                        <div class="content-type movie">Movie</div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        
        ${series.length > 0 ? `
        <div class="content-section">
            <div class="content-header">
                📺 TV Series <span class="content-count">${series.length}</span>
            </div>
            <div class="content-grid">
                ${series.map(show => `
                    <div class="content-item">
                        <img class="content-poster" src="${show.poster_url || 'https://via.placeholder.com/80x120.png?text=No+Poster'}" alt="${show.title}">
                        <div class="content-title">${show.title}</div>
                        <div class="content-type series">Series</div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        
        ${movies.length === 0 && series.length === 0 ? `
        <div class="content-section">
            <div class="empty-content">
                <p>🎭 No content has been added to this group yet.</p>
                <p>Start by adding some movies or TV series from Stremio!</p>
            </div>
        </div>
        ` : ''}
    </div>
</body>
</html>
  `;
}

async function resolveKitsuToImdb(kitsuId) {
    try {
        console.log(`🎌 Resolving Kitsu ID ${kitsuId}...`);

        // Get anime data from Kitsu
        const kitsuResponse = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`);
        if (!kitsuResponse.ok) {
            throw new Error('Kitsu anime not found');
        }

        const kitsuData = await kitsuResponse.json();
        const anime = kitsuData.data.attributes;

        const title = anime.canonicalTitle || anime.titles?.en;
        const year = anime.startDate ? new Date(anime.startDate).getFullYear() : null;

        if (!title) {
            throw new Error('No title found for anime');
        }

        console.log(`Found anime: "${title}" (${year})`);

        // Try to find it in OMDB
        let omdbUrl = `${OMDB_BASE_URL}?t=${encodeURIComponent(title)}&apikey=${OMDB_API_KEY}`;
        if (year) omdbUrl += `&y=${year}`;

        const omdbResponse = await fetch(omdbUrl);
        const omdbData = await omdbResponse.json();

        if (omdbData.Response === 'True' && omdbData.imdbID) {
            console.log(`✅ Found IMDB match: "${title}" → ${omdbData.imdbID}`);
            return omdbData.imdbID;
        }

        // If exact match failed, try search
        const searchUrl = `${OMDB_BASE_URL}?s=${encodeURIComponent(title)}&apikey=${OMDB_API_KEY}`;
        const searchResponse = await fetch(searchUrl);
        const searchData = await searchResponse.json();

        if (searchData.Response === 'True' && searchData.Search && searchData.Search.length > 0) {
            // Take the first result
            const firstResult = searchData.Search[0];
            console.log(`✅ Found IMDB via search: "${title}" → ${firstResult.imdbID}`);
            return firstResult.imdbID;
        }

        return null;

    } catch (error) {
        console.error(`Error resolving Kitsu ${kitsuId}:`, error);
        return null;
    }
}

/**
 * Centralized logic to add content to a group, checking for duplicates.
 * @param {string} groupId - The ID of the group.
 * @param {string} imdbId - The IMDB ID of the content to add.
 * @returns {Promise<object>} An object containing the success status, message, and content info.
 */


async function addContentToGroup(groupId, contentId) {
    console.log('=== addContentToGroup START ===');
    console.log('GroupId:', groupId);
    console.log('ContentId received:', contentId);

    try {
        let imdbId;

        // Check if it's an IMDB ID (starts with 'tt')
        if (contentId && contentId.match(/^tt\d+$/)) {
            imdbId = contentId;
            console.log('✅ Using IMDB ID directly:', imdbId);
        }
        // Check if it's a Kitsu ID (just numbers)
        else if (contentId && contentId.match(/^\d+$/)) {
            console.log('🎌 Detected Kitsu ID, attempting resolution...');

            imdbId = await resolveKitsuToImdb(contentId);

            if (!imdbId) {
                throw new Error(`Could not find IMDB match for Kitsu anime ${contentId}. This anime might not be available on IMDB.`);
            }

            console.log(`✅ Resolved Kitsu ${contentId} → IMDB ${imdbId}`);
        }
        else {
            throw new Error(`Invalid content ID format: "${contentId}". Use IMDB format (tt1234567) or Kitsu ID (12345).`);
        }

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

        // Add to database with try-catch for constraint errors
        console.log('Adding to database...');
        try {
            await db.addContent(groupId, imdbId, info.title, info.type, info.poster, info.genres);
            console.log('Successfully added to database');
        } catch (dbError) {
            // Handle SQLite constraint errors (duplicates that slipped through)
            if (dbError.code === 'SQLITE_CONSTRAINT' && dbError.message.includes('UNIQUE constraint failed')) {
                console.log('Caught duplicate insertion at database level - race condition detected');

                // Get the existing content info for a proper response
                const existingContent = await db.getContentByImdbId(groupId, imdbId);
                const title = existingContent ? existingContent.title : info.title;

                return {
                    success: false,
                    message: `"${title}" is already in the group list.`,
                    info: null,
                    isDuplicate: true
                };
            }
            // Re-throw other database errors
            throw dbError;
        }

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

function extractContentId(input) {
    if (!input) return null;

    const trimmed = input.trim();

    // IMDB ID - direct format like "tt1234567"
    if (trimmed.match(/^tt\d+$/)) {
        return { type: 'imdb', id: trimmed };
    }

    // IMDB URL - extract from URL
    const imdbMatch = trimmed.match(/(?:imdb\.com\/title\/)?(tt\d+)/);
    if (imdbMatch) {
        return { type: 'imdb', id: imdbMatch[1] };
    }

    // Kitsu ID - support both direct ID and URL
    const kitsuMatch = trimmed.match(/(?:kitsu\.io\/anime\/)?(\d+)/);
    if (kitsuMatch) {
        return { type: 'kitsu', id: kitsuMatch[1] };
    }

    return null;
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
        const { contentId } = req.body; 
        const { id: groupId } = req.params;

        const parsedId = extractContentId(contentId);
        if (!parsedId) {
            return res.status(400).json({ error: 'Invalid content ID format (use tt123456 for IMDB or 12345 for Kitsu).' });
        }

        let imdbId;

        if (parsedId.type === 'imdb') {
            imdbId = parsedId.id;
        } else if (parsedId.type === 'kitsu') {
            imdbId = await resolveKitsuToImdb(parsedId.id);
            if (!imdbId) {
                return res.status(404).json({ error: 'Could not resolve Kitsu anime to IMDB. Try using the IMDB ID instead.' });
            }
        }

        const result = await addContentToGroup(groupId, imdbId);

        if (result.isDuplicate) {
            return res.status(409).json({ error: result.message });
        }

        res.status(201).json(result);
    } catch (error) {
        console.error('Error adding content:', error);
        if (error.message.includes('OMDB')) return res.status(404).json({ error: error.message });
        res.status(500).json({ error: 'Failed to add content to the group' });
    }
});


// Fetch movie/series info from OMDB (proxy for web UI)
app.get('/api/content/info/:contentId', async (req, res) => {
    try {
        const { contentId } = req.params;
        const parsedId = extractContentId(contentId);

        if (!parsedId) {
            return res.status(400).json({ error: 'Invalid content ID format.' });
        }

        let imdbId;

        if (parsedId.type === 'imdb') {
            imdbId = parsedId.id;
        } else if (parsedId.type === 'kitsu') {
            imdbId = await resolveKitsuToImdb(parsedId.id);
            if (!imdbId) {
                return res.status(404).json({ error: 'Could not find IMDB match for this anime.' });
            }
        } else {
            return res.status(400).json({ error: 'Unsupported content ID type.' });
        }

        const info = await fetchOMDBInfo(imdbId);
        res.json({ ...info, originalId: contentId, resolvedImdbId: imdbId });

    } catch (error) {
        console.error('Error fetching content info:', error);
        res.status(404).json({ error: error.message });
    }
});

// Delete content from a group
app.delete('/api/groups/:groupId/content/:contentId', async (req, res) => {
  console.log('=== DELETE CONTENT REQUEST START ===');
  console.log('GroupId:', req.params.groupId);
  console.log('ContentId:', req.params.contentId);
  
  try {
    const { groupId, contentId } = req.params;
    
    // Verify the group exists
    const group = await db.getGroup(groupId);
    if (!group) {
      console.log('Group not found');
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Get the content info before deleting (for response message)
    const content = await db.getContentById(contentId, groupId);
    if (!content) {
      console.log('Content not found or does not belong to this group');
      return res.status(404).json({ error: 'Content not found' });
    }
    
    console.log('Deleting content:', { title: content.title, type: content.type });
    
    // Delete the content
    const deletedCount = await db.deleteContent(contentId, groupId);
    
    if (deletedCount === 0) {
      console.log('No content was deleted');
      return res.status(404).json({ error: 'Content not found or already deleted' });
    }
    
    console.log('Content deleted successfully');
    
    // Broadcast the deletion to the specific group's room
    io.to(groupId).emit('content-deleted', {
      contentId: parseInt(contentId),
      title: content.title,
      type: content.type
    });
    
    res.json({
      success: true,
      message: `"${content.title}" was removed from the group.`,
      deletedContent: {
        id: content.id,
        title: content.title,
        type: content.type
      }
    });
    
    console.log('=== DELETE CONTENT REQUEST SUCCESS ===');
  } catch (error) {
    console.error('=== DELETE CONTENT REQUEST FAILED ===');
    console.error('Error deleting content:', error);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});


// --- STREMIO ADDON ROUTES ---

// Stremio addon manifest

app.get('/:groupId/manifest.json', async (req, res) => {
  console.log('=== MANIFEST REQUEST START ===');
  console.log('GroupId from URL:', req.params.groupId);
  
  try {
    const { groupId } = req.params;
    const group = await db.getGroup(groupId);
    
    if (!group) {
      console.log('Group not found, returning 404');
      return res.status(404).json({ error: 'Addon not found.' });
    }

    console.log('Group found:', group.name);

    // ALWAYS show both catalogs
    const catalogs = [
      { id: 'shared-movies', type: 'movie', name: `${group.name} - Shared List` },
      { id: 'shared-series', type: 'series', name: `${group.name} - Shared List` }
    ];

    const manifest = {
      id: `stremio.groups.${groupId}`,
      version: '1.0.0',
      name: `${group.name} - Group List`,
      description: `Shared movie and series catalog for the group: ${group.name}`,
      logo: `${req.protocol}://${req.get('host')}/logo.png`,
      resources: ['catalog', 'stream'],
      types: ['movie', 'series'],
      catalogs: catalogs
    };

    console.log('Generated static manifest with both catalogs always visible');

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(manifest);
    
    console.log('=== MANIFEST REQUEST SUCCESS ===');
  } catch (error) {
    console.error('=== MANIFEST REQUEST ERROR ===');
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

        console.log(`Raw ID from Stremio: "${id}"`);

        // ID Extraction logic
        let contentId;

        if (id.startsWith('kitsu:')) {
            // Format: "kitsu:12345" or "kitsu:12345:1:1"
            const parts = id.split(':');
            contentId = parts[1]; // Get the number after "kitsu:"
            console.log(`Extracted Kitsu ID: "${contentId}"`);
        } else if (id.match(/^kitsu\d+/)) {
            // Format: "kitsu12345"
            contentId = id.replace('kitsu', '');
            console.log(`Extracted Kitsu ID from kitsu prefix: "${contentId}"`);
        } else {
            // Standard format: "tt1234567" or "tt1234567:1:1"
            contentId = id.split(':')[0];
            console.log(`Extracted standard ID: "${contentId}"`);
        }

        console.log(`Stream request: groupId=${groupId}, contentId=${contentId}`);

        const group = await db.getGroup(groupId);
        if (!group) {
            console.log('Group not found');
            return res.status(404).json({ streams: [] });
        }

        // Check if content already exists
        let existingCheck;

        if (contentId && contentId.match(/^tt\d+$/)) {
            // IMDB ID - check directly
            existingCheck = await db.getContentByImdbId(groupId, contentId);
        } else if (contentId && contentId.match(/^\d+$/)) {
            // Kitsu ID - need to resolve to IMDB first to check
            console.log('🎌 Resolving Kitsu ID to check for existing content...');
            const resolvedImdbId = await resolveKitsuToImdb(contentId);
            if (resolvedImdbId) {
                existingCheck = await db.getContentByImdbId(groupId, resolvedImdbId);
            }
        }

        if (existingCheck) {
            console.log('Content already exists in group');
            return res.json({
                streams: [{
                    name: `[${group.name}]`,
                    title: `✅ Already in group: "${existingCheck.title}"`,
                    externalUrl: `${req.protocol}://${req.get('host')}/success/${groupId}?existing=${encodeURIComponent(existingCheck.title)}`,
                    behaviorHints: {
                        notWebReady: true,
                        bingeGroup: `${groupId}-already-added`
                    }
                }]
            });
        }

        // For new content, provide the add action
        console.log('Providing add action for new content');

        res.json({
            streams: [{
                name: `[${group.name}]`,
                title: '✨ Add to Group List',
                externalUrl: `${req.protocol}://${req.get('host')}/api/groups/${groupId}/add-from-stremio/${contentId}`,
                behaviorHints: {
                    notWebReady: true,
                    bingeGroup: `${groupId}-add-to-list`
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
    console.log('User-Agent:', req.get('User-Agent'));

    try {
        const { groupId, imdbId } = req.params;
        const result = await addContentToGroup(groupId, imdbId);

        console.log('Add content result:', result);

        const successUrl = `/success/${groupId}?added=${encodeURIComponent(result.info?.title || 'content')}&duplicate=${result.isDuplicate}`;
        res.redirect(successUrl);

    } catch (error) {
        console.error('Error adding content from Stremio:', error);
        const errorUrl = `/success/${req.params.groupId}?error=${encodeURIComponent(error.message)}`;
        res.redirect(errorUrl);
    }
});

// Success page after adding content
app.get('/success/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;
        const { added, duplicate, existing, error } = req.query;

        const group = await db.getGroup(groupId);
        if (!group) {
            return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Group Not Found</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 2rem; background: #f5f5f5;">
            <h1 style="color: #dc3545;">Group Not Found</h1>
            <p>The group you're looking for doesn't exist.</p>
        </body>
        </html>
      `);
        }

        // Get current content in the group
        const content = await db.getContentByGroup(groupId);
        const movies = content.filter(item => item.type === 'movie');
        const series = content.filter(item => item.type === 'series');

        // Generate the success page HTML
        const successHtml = generateSuccessPageHTML(group, { added, duplicate, existing, error }, movies, series, req);
        res.send(successHtml);

    } catch (error) {
        console.error('Error serving success page:', error);
        res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Error</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 2rem; background: #f5f5f5;">
          <h1 style="color: #dc3545;">Error</h1>
          <p>Something went wrong. Please try again.</p>
      </body>
      </html>
    `);
    }
});

// Stremio catalog provider
app.get('/:groupId/catalog/:type/:catalogId.json', async (req, res) => {
  try {
    const { groupId, catalogId } = req.params;
    let contentType = null;

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

// --- HEALTH CHECK ---
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

// Shutdown
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