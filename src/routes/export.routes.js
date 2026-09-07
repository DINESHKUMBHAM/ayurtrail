const express = require('express');

const db = require('../db/pool');
const { authenticateToken, requireRole } = require('../middleware/auth');
const writeAuditLog = require('../utils/audit');
const { rowsToCsv } = require('../utils/csv');

const router = express.Router();

// Supported export types and the query behind each.
const EXPORT_QUERIES = {
  safety: `
    SELECT ae.id, COALESCE(p.patient_code, 'N/A') AS patient_code, COALESCE(t.trial_code, 'N/A') AS trial_code,
           ae.severity, ae.suspected_herb, ae.symptom_description, ae.reported_at
    FROM adverse_events ae
    LEFT JOIN patients p ON ae.patient_id = p.id
    LEFT JOIN trials t ON ae.trial_id = t.id
    ORDER BY ae.reported_at DESC
  `,
  patients: `SELECT p.id, p.patient_code, t.trial_code, p.prakriti_baseline, p.status FROM patients p JOIN trials t ON p.trial_id = t.id`,
  audit: `SELECT * FROM audit_logs ORDER BY timestamp DESC`
};

// A safety export with no rows still returns a header-only CSV so regulatory
// submissions get a well-formed file rather than a 404.
const EMPTY_EXPORT_HEADERS = {
  safety: 'id,patient_code,trial_code,severity,suspected_herb,symptom_description,reported_at\n'
};

// GET /api/export/:type
router.get('/:type', authenticateToken, requireRole('AUDITOR', 'ETHICS', 'PI', 'ADMIN'), async (req, res) => {
  try {
    const { type } = req.params;
    const filename = `${type}_export_${Date.now()}.csv`;

    const query = EXPORT_QUERIES[type];
    if (!query) {
      return res.status(400).json({ error: 'Invalid export type.' });
    }

    const [rows] = await db.query(query);

    if (rows.length === 0) {
      const defaultHeaders = EMPTY_EXPORT_HEADERS[type];
      if (!defaultHeaders) {
        return res.status(404).send('No records found.');
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(defaultHeaders);
    }

    const csv = rowsToCsv(rows);

    await writeAuditLog(req.user.id, 'EXPORT_DATA', type, 0, { type });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
