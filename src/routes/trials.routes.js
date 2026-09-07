const express = require('express');

const db = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/trials
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM trials ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
