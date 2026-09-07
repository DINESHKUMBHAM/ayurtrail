const express = require('express');

const db = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');
const validateId = require('../utils/validateId');

const router = express.Router();

// GET /api/queries
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT q.*, t.trial_code FROM queries_deviations q JOIN trials t ON q.trial_id = t.id ORDER BY q.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/queries
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { trial_id, patient_id, category, description, severity } = req.body;
    const raised_by = req.user.name;

    const validTrialId = validateId(trial_id, 'Trial ID');
    const validPatientId = validateId(patient_id, 'Patient ID');

    const [result] = await db.execute(
      `INSERT INTO queries_deviations (trial_id, patient_id, category, description, severity, raised_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [validTrialId, validPatientId, category, description, severity, raised_by]
    );

    res.status(201).json({ id: result.insertId, status: 'OPEN' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/queries/:id/resolve
// Role check is inline rather than via requireRole so the original 403 message
// is preserved.
router.put('/:id/resolve', authenticateToken, async (req, res) => {
  try {
    if (!['PI', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Unauthorized. Only PIs or Admins can resolve queries.' });
    }

    const queryId = validateId(req.params.id, 'Query ID');
    const { resolution_notes } = req.body;
    const resolved_by = req.user.name;

    await db.execute(
      `UPDATE queries_deviations SET status = 'RESOLVED', resolution_notes = ?, resolved_by = ? WHERE id = ?`,
      [resolution_notes || '', resolved_by, queryId]
    );

    res.json({ message: 'Query resolved successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
