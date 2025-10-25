const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

// Configuration
const PORT = process.env.PORT || 8080;

// MySQL Database Configuration
const dbConfig = {
  host: '217.21.84.52',
  user: 'u617065149_ayushi',
  password: 'Ayushi@TINT25',
  database: 'u617065149_Ayushi'
};

// Initialize Express
const app = express();

// CORS Configuration
app.use(cors({
  origin: ['https://musclemanias.in', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Handle preflight requests explicitly
app.options('*', cors());

// Body parser
app.use(express.json({ limit: '10mb' }));

// Initialize MySQL Connection Pool
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Logging helper
function log(message, level = 'info') {
  console.log(`[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}`);
}

// --- Fingerprint Processing (Mock for now) ---
function processFingerprintSample(sampleData) {
  return Buffer.from(sampleData, 'base64').toString('base64').slice(0, 512);
}

// --- Enroll Fingerprint ---
async function enrollFingerprint(userId, sampleData, fingerName, status) {
  try {
    if (!userId || !sampleData) throw new Error('userId and sample are required');

    const template = processFingerprintSample(sampleData);
    const finalStatus = status || 'Active';

    await pool.query(
      'INSERT INTO gym_fingerprints (user_id, template, finger_name, status, created_at) VALUES (?, ?, ?, ?, ?)',
      [userId, template, fingerName || 'Unknown', finalStatus, new Date()]
    );

    log(`Fingerprint enrolled for user ${userId} (${fingerName || 'Unknown'})`);

    return {
      success: true,
      message: 'Enrollment successful',
      userId,
      fingerName,
      status: finalStatus
    };
  } catch (error) {
    log(`Enrollment failed: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

// --- Verify Fingerprint ---
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
    const newTemplate = processFingerprintSample(sampleData);

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

// --- Routes ---

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'Fingerprint API',
    version: '1.1.0'
  });
});

// Initialize
app.post('/fingerprint/initialize', async (req, res) => {
  try {
    log(`Initialize request from ${req.get('Origin') || 'unknown'}`);
    res.json({
      success: true,
      type: 'initialized',
      devices: [{ id: 'usb-scanner', name: 'Optical USB Fingerprint Scanner' }]
    });
  } catch (error) {
    log(`Initialize error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// List Devices
app.post('/fingerprint/list_devices', async (req, res) => {
  try {
    log('Received list_devices request');
    res.json({
      success: true,
      devices: [{ id: 'usb-scanner', name: 'Optical USB Fingerprint Scanner' }]
    });
  } catch (error) {
    log(`List devices error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Capture Fingerprint
app.post('/fingerprint/capture', async (req, res) => {
  try {
    log('Received capture request');
    res.json({
      success: true,
      message: 'Capture request received; connect USB scanner client to send sample'
    });
  } catch (error) {
    log(`Capture error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Enroll Fingerprint
app.post('/fingerprint/enroll', async (req, res) => {
  try {
    const { userId, sample, fingerName, status } = req.body;
    log(`Received enroll request for user ${userId}`);
    const response = await enrollFingerprint(userId, sample, fingerName, status);
    res.json(response);
  } catch (error) {
    log(`Enroll error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify Fingerprint
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

// List Templates
app.get('/fingerprint/list_templates', async (req, res) => {
  try {
    log('Received list_templates request');
    const [rows] = await pool.query('SELECT user_id, finger_name, status, created_at FROM gym_fingerprints');
    res.json({
      success: true,
      templates: rows,
      count: rows.length
    });
  } catch (error) {
    log(`List templates error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete Template
app.delete('/fingerprint/delete_template', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

    log(`Received delete_template request for user ${userId}`);
    const [result] = await pool.query('DELETE FROM gym_fingerprints WHERE user_id = ?', [userId]);

    res.json({
      success: result.affectedRows > 0,
      message: result.affectedRows > 0 ? 'Template deleted' : 'Template not found'
    });
  } catch (error) {
    log(`Delete template error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health Check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const [result] = await pool.query('SELECT COUNT(*) as count FROM gym_fingerprints');
    res.json({
      status: 'ok',
      dbConnected: true,
      templatesCount: result[0].count
    });
  } catch (error) {
    log(`Health check error: ${error.message}`, 'error');
    res.status(500).json({ status: 'error', error: 'Database connection failed' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  log(`Unhandled error: ${err.message}`, 'error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start Server
app.listen(PORT, async () => {
  log(`Server ready at http://0.0.0.0:${PORT}`);
  log(`Health check at http://0.0.0.0:${PORT}/health`);
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
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('SIGTERM received, shutting down...');
  await pool.end();
  process.exit(0);
});
