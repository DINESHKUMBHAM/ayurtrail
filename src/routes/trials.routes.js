const express = require('express');

const db = require('../db/pool');
const { authenticateToken, requireRole } = require('../middleware/auth');
const writeAuditLog = require('../utils/audit');

const router = express.Router();

// Phases accepted when registering a protocol.
const VALID_PHASES = ['I', 'II', 'III', 'IV'];
const VALID_STATUSES = ['ACTIVE', 'OPEN', 'CLOSED', 'COMPLETED'];

// GET /api/trials
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM trials ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trials -- register a new clinical trial.
// Restricted to PI/ADMIN: opening a protocol is a sponsor-level action, not
// something a coordinator does while registering participants.
router.post('/', authenticateToken, requireRole('PI', 'ADMIN'), async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { trial_code, title, phase, status, target_enrollment, start_date } = req.body;

    const code = String(trial_code || '').trim();
    const trialTitle = String(title || '').trim();
    const trialPhase = String(phase || '').trim().toUpperCase();
    const trialStatus = String(status || 'ACTIVE').trim().toUpperCase();

    if (!code) {
      await connection.rollback();
      return res.status(400).json({ error: 'Trial code is required.' });
    }
    if (!trialTitle) {
      await connection.rollback();
      return res.status(400).json({ error: 'Trial title is required.' });
    }
    if (!VALID_PHASES.includes(trialPhase)) {
      await connection.rollback();
      return res.status(400).json({ error: `Invalid phase. Expected one of: ${VALID_PHASES.join(', ')}.` });
    }
    if (!VALID_STATUSES.includes(trialStatus)) {
      await connection.rollback();
      return res.status(400).json({ error: `Invalid status. Expected one of: ${VALID_STATUSES.join(', ')}.` });
    }

    let targetEnrollment = null;
    if (target_enrollment !== undefined && target_enrollment !== null && target_enrollment !== '') {
      targetEnrollment = parseInt(target_enrollment, 10);
      if (isNaN(targetEnrollment) || targetEnrollment <= 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'Target enrollment must be a positive integer.' });
      }
    }

    const startDate = start_date ? String(start_date).trim() : null;
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Start date must be in YYYY-MM-DD format.' });
    }

    const [existing] = await connection.query(
      'SELECT id FROM trials WHERE UPPER(TRIM(trial_code)) = ?',
      [code.toUpperCase()]
    );
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(409).json({ error: `Trial code "${code}" already exists.` });
    }

    const [result] = await connection.execute(
      `INSERT INTO trials (trial_code, title, phase, status, target_enrollment, start_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, trialTitle, trialPhase, trialStatus, targetEnrollment, startDate]
    );

    await writeAuditLog(req.user.id, 'CREATE_TRIAL', 'trials', result.insertId, {
      trial_code: code,
      title: trialTitle,
      phase: trialPhase,
      status: trialStatus,
      target_enrollment: targetEnrollment,
      start_date: startDate
    });

    await connection.commit();

    res.status(201).json({
      status: 'Success',
      message: 'Clinical trial registered.',
      id: result.insertId,
      trial_code: code
    });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
