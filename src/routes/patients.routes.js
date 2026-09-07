const express = require('express');

const db = require('../db/pool');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validateId = require('../utils/validateId');
const writeAuditLog = require('../utils/audit');

const router = express.Router();

// GET /api/patients
router.get('/', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT p.id, p.patient_code, p.prakriti_baseline, p.status, t.trial_code
      FROM patients p JOIN trials t ON p.trial_id = t.id ORDER BY p.id DESC
    `;
    const [rows] = await db.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/patients
router.post('/', authenticateToken, requireRole('PI', 'CRC', 'ADMIN'), async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { trial_id, prakriti_baseline } = req.body;

    const validTrialId = validateId(trial_id, 'Trial ID');
    if (!prakriti_baseline || typeof prakriti_baseline !== 'string') {
      return res.status(400).json({ error: 'Invalid Prakriti baseline value.' });
    }

    const patientCode = `PAT-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    // enrolled_at is set explicitly (the column carries no DEFAULT -- see
    // src/db/migrations.js) and drives the recruitment velocity metric.
    const [result] = await connection.execute(
      `INSERT INTO patients (patient_code, trial_id, prakriti_baseline, status, enrolled_at) VALUES (?, ?, ?, 'ENROLLED', NOW())`,
      [patientCode, validTrialId, prakriti_baseline]
    );

    await writeAuditLog(req.user.id, 'REGISTER_PATIENT', 'patients', result.insertId, { patient_code: patientCode, trial_id: validTrialId, prakriti_baseline });
    await connection.commit();
    res.status(201).json({ status: 'Success', patient_code: patientCode, id: result.insertId });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
