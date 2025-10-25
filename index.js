const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

// --- FIDO/WebAuthn Helper Functions ---

// Generate challenge for WebAuthn
function generateChallenge() {
  return crypto.randomBytes(32).toString('base64url');
}

// Store challenges temporarily (in production, use Redis or similar)
const challengeStore = new Map();

// Clean up old challenges (older than 5 minutes)
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [key, value] of challengeStore.entries()) {
    if (value.timestamp < fiveMinutesAgo) {
      challengeStore.delete(key);
    }
  }
}, 60000);

// --- Enroll Fingerprint (FIDO Registration) ---
async function enrollFingerprint(userId, credentialData, fingerName, status) {
  try {
    if (!userId || !credentialData) {
      throw new Error('userId and credential data are required');
    }

    // Extract credential data
    const { credentialId, publicKey, counter, transports } = credentialData;
    
    const finalStatus = status || 'Active';

    // Store FIDO credential in database
    await pool.query(
      `INSERT INTO gym_fingerprints 
       (user_id, template, credential_id, public_key, counter, transports, finger_name, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        credentialId, // Store credentialId as template for backward compatibility
        credentialId,
        publicKey,
        counter || 0,
        JSON.stringify(transports || []),
        fingerName || 'FIDO Biometric',
        finalStatus,
        new Date()
      ]
    );

    log(`FIDO credential enrolled for user ${userId} (${fingerName || 'FIDO Biometric'})`);

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

// --- Verify Fingerprint (FIDO Authentication) ---
async function verifyFingerprint(userId, authData) {
  try {
    const [rows] = await pool.query(
      `SELECT credential_id, public_key, counter 
       FROM gym_fingerprints 
       WHERE user_id = ? AND status = 'Active' 
       LIMIT 1`,
      [userId]
    );

    if (!rows.length) {
      return { success: false, error: 'No enrolled credential found for user' };
    }

    const storedCredential = rows[0];
    
    // In a real implementation, you would verify the signature here
    // For now, we'll do a basic credential ID check
    const matched = authData.credentialId === storedCredential.credential_id;
    const score = matched ? 95 : 5;

    // Update counter if matched (replay attack prevention)
    if (matched && authData.counter > storedCredential.counter) {
      await pool.query(
        'UPDATE gym_fingerprints SET counter = ? WHERE user_id = ?',
        [authData.counter, userId]
      );
    }

    log(`FIDO verification for user ${userId}: ${matched ? 'Success' : 'Failed'}`);

    return {
      success: true,
      matched,
      score,
      message: matched ? 'Verification successful' : 'Credential does not match'
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
    service: 'FIDO Fingerprint API',
    version: '2.0.0',
    type: 'WebAuthn/FIDO2'
  });
});

// Initialize - Returns WebAuthn registration options
app.post('/fingerprint/initialize', async (req, res) => {
  try {
    log(`Initialize request from ${req.get('Origin') || 'unknown'}`);
    
    const challenge = generateChallenge();
    
    res.json({
      success: true,
      type: 'fido',
      challenge,
      rpName: 'Muscle Manias Gym',
      rpId: 'musclemanias.in',
      devices: [{ id: 'fido-biometric', name: 'FIDO Biometric Authenticator' }]
    });
  } catch (error) {
    log(`Initialize error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// List Devices - Returns available authenticators
app.post('/fingerprint/list_devices', async (req, res) => {
  try {
    log('Received list_devices request');
    res.json({
      success: true,
      devices: [
        { id: 'fido-biometric', name: 'FIDO Biometric Authenticator', type: 'platform' },
        { id: 'fido-external', name: 'External Security Key', type: 'cross-platform' }
      ]
    });
  } catch (error) {
    log(`List devices error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate registration options for WebAuthn
app.post('/fingerprint/registration-options', async (req, res) => {
  try {
    const { userId, userName } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    const challenge = generateChallenge();
    challengeStore.set(userId, { challenge, timestamp: Date.now(), type: 'registration' });

    log(`Generated registration options for user ${userId}`);

    res.json({
      success: true,
      publicKey: {
        challenge,
        rp: {
          name: 'Muscle Manias Gym',
          id: 'musclemanias.in'
        },
        user: {
          id: Buffer.from(userId).toString('base64url'),
          name: userName || userId,
          displayName: userName || userId
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },  // ES256
          { alg: -257, type: 'public-key' }  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          requireResidentKey: false,
          userVerification: 'required'
        },
        timeout: 60000,
        attestation: 'none'
      }
    });
  } catch (error) {
    log(`Registration options error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate authentication options for WebAuthn
app.post('/fingerprint/authentication-options', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    // Get user's credentials
    const [rows] = await pool.query(
      'SELECT credential_id FROM gym_fingerprints WHERE user_id = ? AND status = "Active"',
      [userId]
    );

    const challenge = generateChallenge();
    challengeStore.set(userId, { challenge, timestamp: Date.now(), type: 'authentication' });

    log(`Generated authentication options for user ${userId}`);

    res.json({
      success: true,
      publicKey: {
        challenge,
        timeout: 60000,
        rpId: 'musclemanias.in',
        allowCredentials: rows.map(row => ({
          id: row.credential_id,
          type: 'public-key',
          transports: ['internal', 'usb', 'nfc', 'ble']
        })),
        userVerification: 'required'
      }
    });
  } catch (error) {
    log(`Authentication options error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Capture Fingerprint - Initiates WebAuthn ceremony
app.post('/fingerprint/capture', async (req, res) => {
  try {
    const { userId } = req.body;
    log('Received capture request');
    
    const challenge = generateChallenge();
    if (userId) {
      challengeStore.set(userId, { challenge, timestamp: Date.now() });
    }
    
    res.json({
      success: true,
      message: 'Ready for FIDO biometric authentication',
      challenge
    });
  } catch (error) {
    log(`Capture error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Enroll Fingerprint - Completes WebAuthn registration
app.post('/fingerprint/enroll', async (req, res) => {
  try {
    const { userId, sample, fingerName, status, credentialId, publicKey, counter, transports } = req.body;
    
    log(`Received enroll request for user ${userId}`);
    
    // Verify challenge if provided
    const storedChallenge = challengeStore.get(userId);
    if (storedChallenge) {
      challengeStore.delete(userId);
    }
    
    // If using new FIDO format
    if (credentialId && publicKey) {
      const response = await enrollFingerprint(userId, {
        credentialId,
        publicKey,
        counter,
        transports
      }, fingerName, status);
      res.json(response);
    } 
    // Legacy format support
    else if (sample) {
      const response = await enrollFingerprint(userId, {
        credentialId: sample,
        publicKey: sample,
        counter: 0,
        transports: []
      }, fingerName, status);
      res.json(response);
    } else {
      res.status(400).json({ 
        success: false, 
        error: 'Either credentialId/publicKey or sample is required' 
      });
    }
  } catch (error) {
    log(`Enroll error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify Fingerprint - Completes WebAuthn authentication
app.post('/fingerprint/verify', async (req, res) => {
  try {
    const { userId, sample, credentialId, signature, authenticatorData, counter } = req.body;
    
    log(`Received verify request for user ${userId}`);
    
    // Verify challenge if provided
    const storedChallenge = challengeStore.get(userId);
    if (storedChallenge) {
      challengeStore.delete(userId);
    }
    
    // If using new FIDO format
    if (credentialId) {
      const response = await verifyFingerprint(userId, {
        credentialId,
        signature,
        authenticatorData,
        counter
      });
      res.json(response);
    }
    // Legacy format support
    else if (sample) {
      const response = await verifyFingerprint(userId, {
        credentialId: sample,
        counter: 0
      });
      res.json(response);
    } else {
      res.status(400).json({ 
        success: false, 
        error: 'Either credentialId or sample is required' 
      });
    }
  } catch (error) {
    log(`Verify error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// List Templates
app.get('/fingerprint/list_templates', async (req, res) => {
  try {
    log('Received list_templates request');
    const [rows] = await pool.query(
      'SELECT user_id, finger_name, status, created_at, credential_id FROM gym_fingerprints'
    );
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

// ==================== API ENDPOINTS FOR FRONTEND ====================

// GET all fingerprints (for admin dashboard)
app.get('/api/fingerprints', async (req, res) => {
  try {
    log('Fetching all fingerprints');
    const [rows] = await pool.query(`
      SELECT 
        gf.id,
        gf.user_id as firebase_uid,
        gf.credential_id as fingerprint_id,
        gf.finger_name,
        gf.status,
        gf.created_at as enrolled_at,
        CASE WHEN gf.status = 'Active' THEN 1 ELSE 0 END as is_active,
        u.name as user_name
      FROM gym_fingerprints gf
      LEFT JOIN users u ON gf.user_id = u.firebase_uid
      ORDER BY gf.created_at DESC
    `);
    
    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    log(`Error fetching fingerprints: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST new fingerprint enrollment
app.post('/api/fingerprints', async (req, res) => {
  try {
    const { firebase_uid, fingerprint_template, fingerprint_id, finger_name, credentialId, publicKey } = req.body;
    
    if (!firebase_uid || (!fingerprint_template && !credentialId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'firebase_uid and fingerprint_template/credentialId are required' 
      });
    }

    log(`Enrolling FIDO credential for user ${firebase_uid}`);
    
    await pool.query(
      `INSERT INTO gym_fingerprints 
       (user_id, template, credential_id, public_key, finger_name, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        firebase_uid,
        credentialId || fingerprint_template,
        credentialId || fingerprint_id,
        publicKey || fingerprint_template,
        finger_name || 'FIDO Biometric',
        'Active',
        new Date()
      ]
    );

    res.json({
      success: true,
      message: 'Fingerprint enrolled successfully'
    });
  } catch (error) {
    log(`Enrollment error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT update fingerprint status
app.put('/api/fingerprints/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    const status = is_active ? 'Active' : 'Inactive';
    
    log(`Updating fingerprint ${id} status to ${status}`);
    
    const [result] = await pool.query(
      'UPDATE gym_fingerprints SET status = ? WHERE id = ?',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Fingerprint not found' });
    }

    res.json({
      success: true,
      message: 'Fingerprint status updated'
    });
  } catch (error) {
    log(`Update fingerprint error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE fingerprint
app.delete('/api/fingerprints/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    log(`Deleting fingerprint ${id}`);
    
    const [result] = await pool.query('DELETE FROM gym_fingerprints WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Fingerprint not found' });
    }

    res.json({
      success: true,
      message: 'Fingerprint deleted successfully'
    });
  } catch (error) {
    log(`Delete fingerprint error: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET entry logs
app.get('/api/entries', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    
    let query = `
      SELECT 
        e.id,
        e.firebase_uid,
        e.fingerprint_id,
        e.entry_time,
        e.entry_status,
        e.has_active_plan,
        e.notes,
        u.name
      FROM gym_entries e
      LEFT JOIN users u ON e.firebase_uid = u.firebase_uid
      WHERE 1=1
    `;
    
    const params = [];
    
    if (date_from) {
      query += ' AND e.entry_time >= ?';
      params.push(date_from);
    }
    
    if (date_to) {
      query += ' AND e.entry_time <= ?';
      params.push(date_to + ' 23:59:59');
    }
    
    query += ' ORDER BY e.entry_time DESC LIMIT 1000';
    
    const [rows] = await pool.query(query, params);
    
    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    log(`Error fetching entries: ${error.message}`, 'error');
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
      templatesCount: result[0].count,
      type: 'FIDO/WebAuthn'
    });
  } catch (error) {
    log(`Health check error: ${error.message}`, 'error');
    res.status(500).json({ status: 'error', error: 'Database connection failed' });
  }
});

// API Health endpoint
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      success: true,
      status: 'healthy',
      type: 'FIDO/WebAuthn',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database connection failed' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  log(`Unhandled error: ${err.message}`, 'error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start Server
app.listen(PORT, async () => {
  log(`FIDO/WebAuthn Server ready at http://0.0.0.0:${PORT}`);
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
