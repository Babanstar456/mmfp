// Initialize Express
const express = require('express');
const https = require('https');
const mysql = require('mysql2/promise');

// Configuration
const PORT = process.env.PORT || 8080; // Changed to 8080 for HTTPS
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
app.use(express.json({ limit: '10mb' })); // Allow larger payloads for fingerprint data

// Initialize MySQL Connection Pool
const pool = mysql.createPool(dbConfig);

// Logging helper
function log(message, level = 'info') {
  console.log(`[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}`);
}

// Process DigitalPersona sample (placeholder; replace with SDK on-premise)
function processDigitalPersonaSample(sampleData) {
  // DigitalPersona client sends base64-encoded feature set
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
    const [rows] = await pool.query(
      'SELECT template FROM gym_fingerprints WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (!rows.length) {
      return { success: false, error: 'No enrolled template found for user' };
    }

    const storedTemplate = rows[0].template;
    const newTemplate = processDigitalPersonaSample(sampleData);

    const matched = storedTemplate === newTemplate;
    const score = matched ? 90 : 10;

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

// HTTPS Endpoints
app.post('/fingerprint/initialize', async (req, res) => {
  try {
    log('Received initialize request');
    res.json({ 
      success: true, 
      type: 'initialized',
      devices: [{ id: 'dp-client', name: 'DigitalPersona Client Scanner' }]
    });
  } catch (error) {
    log(`Initialize error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/fingerprint/list_devices', async (req, res) => {
  try {
    log('Received list_devices request');
    res.json({ 
      success: true, 
      devices: [{ id: 'dp-client', name: 'DigitalPersona Client Scanner' }]
    });
  } catch (error) {
    log(`List devices error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/fingerprint/capture', async (req, res) => {
  try {
    log('Received capture request');
    res.json({ 
      success: true, 
      message: 'Capture request received; use client-side DigitalPersona scanner'
    });
  } catch (error) {
    log(`Capture error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/fingerprint/enroll', async (req, res) => {
  try {
    const { userId, sample } = req.body;
    log(`Received enroll request for user ${userId}`);
    const response = await enrollFingerprint(userId, sample);
    res.json(response);
  } catch (error) {
    log(`Enroll error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/fingerprint/verify', async (req, res) => {
  try {
    const { userId, sample } = req.body;
    log(`Received verify request for user ${userId}`);
    const response = await verifyFingerprint(userId, sample);
    res.json(response);
  } catch (error) {
    log(`Verify error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/fingerprint/list_templates', async (req, res) => {
  try {
    log('Received list_templates request');
    const [rows] = await pool.query('SELECT user_id FROM gym_fingerprints');
    res.json({ 
      success: true, 
      templates: rows.map(row => row.user_id),
      count: rows.length
    });
  } catch (error) {
    log(`List templates error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/fingerprint/delete_template', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }
    log(`Received delete_template request for user ${userId}`);
    const [result] = await pool.query(
      'DELETE FROM gym_fingerprints WHERE user_id = ?',
      [userId]
    );
    res.json({ 
      success: result.affectedRows > 0,
      message: result.affectedRows > 0 ? 'Template deleted' : 'Template not found'
    });
  } catch (error) {
    log(`Delete template error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health Check Endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'ok', 
      dbConnected: true,
      templatesCount: (await pool.query('SELECT COUNT(*) as count FROM gym_fingerprints'))[0][0].count
    });
  } catch (error) {
    log(`Health check error: ${error.message}`, 'error');
    res.status(500).json({ status: 'error', error: 'Database connection failed' });
  }
});

// Start Server
const server = isProduction ? https.createServer(app) : app;
server.listen(PORT, async () => {
  log(`HTTPS server ready at http${isProduction ? 's' : ''}://0.0.0.0:${PORT}/fingerprint`);
  log(`Health check at http${isProduction ? 's' : ''}://0.0.0.0:${PORT}/health`);

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
  server.close(() => {
    log('HTTPS server closed');
    process.exit(0);
  });
});
