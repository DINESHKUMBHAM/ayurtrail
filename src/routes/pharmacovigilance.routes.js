const express = require('express');

const db = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');
const validateId = require('../utils/validateId');
const writeAuditLog = require('../utils/audit');

const router = express.Router();

// POST /api/pharmacovigilance
router.post('/', authenticateToken, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { patient_id, trial_id, severity, symptom_description, suspected_herb } = req.body;

    const validPatientId = validateId(patient_id, 'Patient ID');
    const validTrialId = validateId(trial_id, 'Trial ID');

    const [result] = await connection.execute(
      `INSERT INTO adverse_events (patient_id, trial_id, severity, symptom_description, suspected_herb, reported_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [validPatientId, validTrialId, severity, symptom_description, suspected_herb, req.user.id]
    );

    await writeAuditLog(req.user.id, 'REPORT_AE', 'adverse_events', result.insertId, req.body);
    await connection.commit();
    res.status(201).json({ status: 'Success', id: result.insertId });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// GET /api/pharmacovigilance
router.get('/', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT ae.id, p.patient_code, t.trial_code, ae.severity, ae.symptom_description, ae.suspected_herb, ae.reported_at
      FROM adverse_events ae JOIN patients p ON ae.patient_id = p.id JOIN trials t ON ae.trial_id = t.id ORDER BY ae.reported_at DESC
    `;
    const [rows] = await db.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
