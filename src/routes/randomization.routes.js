const express = require('express');

const db = require('../db/pool');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validateId = require('../utils/validateId');
const writeAuditLog = require('../utils/audit');

const router = express.Router();

// Roles permitted to see the real treatment arm. Everyone else sees BLINDED.
const UNBLINDED_ROLES = ['AUDITOR', 'ETHICS', 'ADMIN'];

// POST /api/patients/:id/randomize
router.post('/patients/:id/randomize', authenticateToken, requireRole('PI', 'CRC'), async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const patientId = validateId(req.params.id, 'Patient ID');

    const [patientRows] = await connection.query('SELECT * FROM patients WHERE id = ?', [patientId]);
    if (patientRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Patient not found.' });
    }
    const patient = patientRows[0];

    const [existing] = await connection.query('SELECT * FROM subject_randomizations WHERE patient_id = ?', [patientId]);
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Subject is already randomized in this study.' });
    }

    const [arms] = await connection.query('SELECT * FROM treatment_arms WHERE trial_id = ?', [patient.trial_id]);
    if (arms.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'No treatment arms configured for this trial.' });
    }

    const selectedArm = arms[Math.floor(Math.random() * arms.length)];
    const kitId = `KIT-2026-${Math.floor(100000 + Math.random() * 900000)}`;

    await connection.execute(
      `INSERT INTO subject_randomizations (patient_id, trial_id, kit_id, arm_id) VALUES (?, ?, ?, ?)`,
      [patientId, patient.trial_id, kitId, selectedArm.id]
    );

    await connection.execute(
      `UPDATE patients SET status = 'RANDOMIZED' WHERE id = ?`,
      [patientId]
    );

    await writeAuditLog(req.user.id, 'SUBJECT_RANDOMIZATION', 'patients', patientId, {
      patient_code: patient.patient_code,
      trial_id: patient.trial_id,
      kit_id: kitId,
      assigned_arm_code: selectedArm.arm_code
    });

    await connection.commit();

    res.json({
      status: 'Success',
      message: 'Subject successfully randomized.',
      patient_code: patient.patient_code,
      assigned_kit_id: kitId
    });

  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// GET /api/randomizations -- treatment arm is masked for blinded roles.
router.get('/randomizations', authenticateToken, async (req, res) => {
  try {
    const isUnblinded = UNBLINDED_ROLES.includes(req.user.role);

    let query = '';
    if (isUnblinded) {
      query = `
        SELECT r.id, p.patient_code, t.trial_code, r.kit_id, a.arm_code, a.arm_name, r.randomized_at
        FROM subject_randomizations r
        JOIN patients p ON r.patient_id = p.id
        JOIN trials t ON r.trial_id = t.id
        JOIN treatment_arms a ON r.arm_id = a.id
        ORDER BY r.id DESC
      `;
    } else {
      query = `
        SELECT r.id, p.patient_code, t.trial_code, r.kit_id, 'BLINDED' AS arm_code, 'BLINDED (DOUBLE-BLIND TRIAL)' AS arm_name, r.randomized_at
        FROM subject_randomizations r
        JOIN patients p ON r.patient_id = p.id
        JOIN trials t ON r.trial_id = t.id
        ORDER BY r.id DESC
      `;
    }

    const [rows] = await db.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
