const express = require('express');

const db = require('../db/pool');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/audit
router.get('/', authenticateToken, requireRole('AUDITOR', 'ETHICS', 'PI', 'ADMIN'), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
