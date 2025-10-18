const WebSocket = require('ws');
const express = require('express');
const https = require('https');
const mysql = require('mysql2/promise');

// Configuration
const PORT = process.env.PORT || 8181;
const WS_PATH = '/fingerprint';
const isProduction = process.env.NODE_ENV === 'production';

// MySQL Database Configuration
const dbConfig = {
  host: process.env.DB_HOST || '217.21.84.52',
  user: 'u617065149_ayushi',
  password: 'Ayushi@TINT25',
  database: 'u617065149_Ayushi'
};

// Initialize Express
const app = express();
app.use(express.json());

// Initialize MySQL Connection Pool
const pool = mysql.createPool(dbConfig);

// Logging helper
function log(message, level = 'info') {
  console.log(`[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}`);
}

// Process DigitalPersona sample (placeholder; replace with SDK on-premise)
function processDigitalPersonaSample(sampleData) {
  // DigitalPersona client sends base64-encoded feature set or raw data
  // In production, use SDK on an on-premise server to extract template
  return Buffer.from(sampleData, 'base64').toString('base64').slice(0, 512); // Simplified
}

// Enroll Fingerprint
async function enrollFingerprint(userId, sampleData) {
  try {
    if (!userId || !sampleData) {
      throw new Error('userId and sample are required');
    }

    const template = processDigitalPersonaSample(sampleData);

    // Store in MySQL
    await pool.query(
      'INSERT INTO gym_fingerprints (user_id, template, created_at) VALUES (?, ?, ?)',
      [userId, template, new Date()]
    );

    log(`Fingerprint enrolled for user ${userId}`);
    return { 
      success: true, 
      message: 'Enrollment successful',
      userId,
      template
    };
  } catch (error) {
    log(`Enrollment failed: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

// Verify Fingerprint
async function verifyFingerprint(userId, sampleData) {
  try {
    // Retrieve template from MySQL
    const [rows] = await pool.query(
      'SELECT template FROM gym_fingerprints WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (!rows.length) {
      return { success: false, error: 'No enrolled template found for user' };
    }

    const storedTemplate = rows[0].template;
    const newTemplate = processDigitalPersonaSample(sampleData);

    // Simplified matching (replace with SDK in production)
    const matched = storedTemplate === newTemplate;
    const score = matched ? 90 : 10; // Simulated score

    log(`Verification for user ${userId}: ${matched ? 'Success' : 'Failed'}`);
    return { 
      success: true, 
      matched,
      score,
      message: matched ? 'Verification successful' : 'Fingerprint does not match'
    };
  } catch (error) {
    log(`Verification failed: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

// WebSocket Server
const server = isProduction ? https.createServer(app) : app;
const wss = new WebSocket.Server({ server, path: WS_PATH });

wss.on('connection', (ws) => {
  log('Client connected to fingerprint service');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      log(`Received command: ${data.command}`);

      let response;

      switch (data.command) {
        case 'initialize':
          response = { 
            success: true, 
            type: 'initialized',
            devices: [{ id: 'dp-client', name: 'DigitalPersona Client Scanner' }]
          };
          break;

        case 'list_devices':
          response = { 
            success: true, 
            devices: [{ id: 'dp-client', name: 'DigitalPersona Client Scanner' }]
          };
          break;

        case 'capture':
          response = { 
            success: true, 
            message: 'Capture request received; use client-side DigitalPersona scanner'
          };
          break;

        case 'enroll':
          response = await enrollFingerprint(data.userId, data.sample);
          break;

        case 'verify':
          response = await verifyFingerprint(data.userId, data.sample);
          break;

        case 'list_templates':
          const [rows] = await pool.query('SELECT user_id FROM gym_fingerprints');
          response = { 
            success: true, 
            templates: rows.map(row => row.user_id),
            count: rows.length
          };
          break;

        case 'delete_template':
          if (!data.userId) {
            response = { success: false, error: 'userId is required' };
          } else {
            const [result] = await pool.query(
              'DELETE FROM gym_fingerprints WHERE user_id = ?',
              [data.userId]
            );
            response = { 
              success: result.affectedRows > 0,
              message: result.affectedRows > 0 ? 'Template deleted' : 'Template not found'
            };
          }
          break;

        default:
          response = { success: false, error: 'Unknown command' };
      }

      ws.send(JSON.stringify(response));
    } catch (error) {
      log(`WebSocket message error: ${error.message}`, 'error');
      ws.send(JSON.stringify({ success: false, error: error.message }));
    }
  });

  ws.on('close', () => {
    log('Client disconnected');
  });

  ws.on('error', (error) => {
    log(`WebSocket error: ${error.message}`, 'error');
  });
});

// Health Check Endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1'); // Test DB connection
    res.json({ 
      status: 'ok', 
      dbConnected: true,
      templatesCount: (await pool.query('SELECT COUNT(*) as count FROM gym_fingerprints'))[0][0].count
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: 'Database connection failed' });
  }
});

// Start Server
server.listen(PORT, async () => {
  log(`WebSocket server ready at ws${isProduction ? 's' : ''}://0.0.0.0:${PORT}${WS_PATH}`);
  log(`Health check at http://0.0.0.0:${PORT}/health`);

  // Verify DB connection
  try {
    await pool.query('SELECT 1');
    log('Database connected successfully');
  } catch (error) {
    log(`Database connection failed: ${error.message}`, 'error');
  }
});

// Graceful Shutdown
process.on('SIGINT', async () => {
  log('Shutting down...');
  await pool.end();
  wss.close(() => {
    log('WebSocket server closed');
    process.exit(0);
  });
});