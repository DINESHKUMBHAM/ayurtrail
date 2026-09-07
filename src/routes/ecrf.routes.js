const express = require('express');
const bcrypt = require('bcrypt');

const db = require('../db/pool');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validateId = require('../utils/validateId');
const writeAuditLog = require('../utils/audit');
const { computeEcrfHash } = require('../utils/ecrfHash');
const { renderEcrfPdf } = require('../services/ecrfPdf');

const router = express.Router();

// GET /api/ecrf
router.get('/', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT e.id, e.patient_id, e.visit_number, e.dosha_data, e.anupana_details, e.created_at,
             s.id AS signature_id, s.data_hash, s.signed_at, u.name AS signer_name
      FROM ecrf_entries e
      LEFT JOIN ecrf_signatures s ON e.id = s.ecrf_id
      LEFT JOIN users u ON s.signer_id = u.id
      ORDER BY e.id DESC
    `;
    const [rows] = await db.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ecrf
router.post('/', authenticateToken, requireRole('PI', 'CRC'), async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { patient_id, visit_number, dosha_data, anupana_details } = req.body;

    const validPatientId = validateId(patient_id, 'Patient ID');
    const validVisitNum = validateId(visit_number, 'Visit Number');

    const [result] = await connection.execute(
      `INSERT INTO ecrf_entries (patient_id, visit_number, dosha_data, anupana_details, recorded_by) VALUES (?, ?, ?, ?, ?)`,
      [validPatientId, validVisitNum, JSON.stringify(dosha_data || {}), anupana_details || '', req.user.id]
    );

    await writeAuditLog(req.user.id, 'INSERT_ECRF', 'ecrf_entries', result.insertId, req.body);
    await connection.commit();
    res.status(201).json({ status: 'Success', ecrf_id: result.insertId });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// PUT /api/ecrf/:id -- refuses to touch a record that carries a signature.
router.put('/:id', authenticateToken, requireRole('PI', 'CRC'), async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const ecrfId = validateId(req.params.id, 'eCRF ID');

    const [signatures] = await connection.query(
      'SELECT id, signed_at FROM ecrf_signatures WHERE ecrf_id = ?',
      [ecrfId]
    );

    if (signatures.length > 0) {
      await connection.rollback();
      return res.status(403).json({
        error: '21 CFR Part 11 Compliance Lock: This eCRF record has been electronically signed and locked. Modifications are strictly forbidden.'
      });
    }

    const { dosha_data, anupana_details } = req.body;
    await connection.execute(
      'UPDATE ecrf_entries SET dosha_data = ?, anupana_details = ? WHERE id = ?',
      [JSON.stringify(dosha_data || {}), anupana_details || '', ecrfId]
    );

    await writeAuditLog(req.user.id, 'UPDATE_ECRF', 'ecrf_entries', ecrfId, req.body);
    await connection.commit();
    res.json({ status: 'Success', message: 'eCRF entry updated successfully.' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// POST /api/ecrf/:id/sign -- 21 CFR Part 11 signature, requires the signer to
// re-enter their password even though they already hold a valid session token.
router.post('/:id/sign', authenticateToken, requireRole('PI', 'ADMIN'), async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const ecrfId = validateId(req.params.id, 'eCRF ID');
    const { signature_reason, password } = req.body;

    if (!password) {
      await connection.rollback();
      return res.status(400).json({ error: '21 CFR Part 11 Violation: Credential re-authentication required.' });
    }

    const [userRows] = await connection.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (userRows.length === 0) {
      await connection.rollback();
      return res.status(401).json({ error: 'Signer user record not found.' });
    }

    const signer = userRows[0];

    const isPasswordValid = await bcrypt.compare(password, signer.password);
    if (!isPasswordValid) {
      await connection.rollback();
      return res.status(401).json({ error: 'Re-authentication Failed: Invalid password for this signer post.' });
    }

    const [existing] = await connection.query('SELECT * FROM ecrf_signatures WHERE ecrf_id = ?', [ecrfId]);
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'eCRF entry is already locked and electronically signed.' });
    }

    const [ecrfRows] = await connection.query('SELECT * FROM ecrf_entries WHERE id = ?', [ecrfId]);
    if (ecrfRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'eCRF record not found.' });
    }

    const dataHash = computeEcrfHash(ecrfRows[0], req.user.id);

    await connection.execute(
      `INSERT INTO ecrf_signatures (ecrf_id, signer_id, signature_reason, data_hash) VALUES (?, ?, ?, ?)`,
      [ecrfId, req.user.id, signature_reason || 'Attestation of Clinical Trial Data Accuracy', dataHash]
    );

    // The audit payload doubles as the snapshot of signed state that the verify
    // route diffs against when a hash mismatch is detected.
    await writeAuditLog(req.user.id, '21CFR11_ELECTRONIC_SIGNATURE', 'ecrf_entries', ecrfId, {
      signer: req.user.name,
      role: req.user.role,
      hash: dataHash,
      reason: signature_reason,
      patient_id: ecrfRows[0].patient_id,
      visit_number: ecrfRows[0].visit_number,
      anupana_details: ecrfRows[0].anupana_details,
      dosha_data: ecrfRows[0].dosha_data
    });

    await connection.commit();
    res.json({ status: 'Success', message: 'eCRF electronically signed and locked.', hash: dataHash });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// GET /api/ecrf/:id/verify -- recomputes the hash and reports field-level drift.
router.get('/:id/verify', authenticateToken, requireRole('AUDITOR', 'ETHICS', 'PI', 'ADMIN'), async (req, res) => {
  try {
    const ecrfId = validateId(req.params.id, 'eCRF ID');

    const [rows] = await db.query(
      `SELECT e.*, s.signer_id, s.data_hash, s.signed_at, s.signature_reason, u.name AS signer_name
       FROM ecrf_entries e
       JOIN ecrf_signatures s ON e.id = s.ecrf_id
       JOIN users u ON s.signer_id = u.id
       WHERE e.id = ?`,
      [ecrfId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No signed signature record found for this eCRF.' });
    }

    const record = rows[0];

    const recalculatedHash = computeEcrfHash(record, record.signer_id);
    const isAuthentic = recalculatedHash === record.data_hash;

    let tamperedFields = [];
    if (!isAuthentic) {
      const [auditRows] = await db.query(
        `SELECT payload FROM audit_logs
         WHERE target_table = 'ecrf_entries' AND record_id = ? AND action = '21CFR11_ELECTRONIC_SIGNATURE'
         ORDER BY timestamp DESC LIMIT 1`,
        [ecrfId]
      );

      if (auditRows.length > 0) {
        try {
          const signedState = typeof auditRows[0].payload === 'string'
            ? JSON.parse(auditRows[0].payload)
            : auditRows[0].payload;

          if (signedState) {
            if (signedState.anupana_details !== undefined && signedState.anupana_details !== record.anupana_details) {
              tamperedFields.push({ field: 'anupana_details', expected: signedState.anupana_details, actual: record.anupana_details });
            }
          }
        } catch (e) {}
      }
    }

    if (isAuthentic) {
      return res.json({
        status: 'VERIFIED',
        message: 'Data integrity verified.',
        signed_by: record.signer_name,
        signed_at: record.signed_at,
        hash: record.data_hash
      });
    } else {
      return res.status(409).json({
        status: 'TAMPER_DETECTED',
        error: 'CRITICAL ALERT: Data hash mismatch detected!',
        stored_hash: record.data_hash,
        recalculated_hash: recalculatedHash,
        tampered_fields: tamperedFields
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ecrf/:id/pdf
router.get('/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const ecrfId = validateId(req.params.id, 'eCRF ID');

    const query = `
      SELECT e.*, p.patient_code, s.data_hash, s.signed_at, s.signature_reason, u.name AS signer_name, u.role AS signer_role
      FROM ecrf_entries e
      JOIN patients p ON e.patient_id = p.id
      LEFT JOIN ecrf_signatures s ON e.id = s.ecrf_id
      LEFT JOIN users u ON s.signer_id = u.id
      WHERE e.id = ?
    `;
    const [rows] = await db.query(query, [ecrfId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'eCRF record not found.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="eCRF_Record_${ecrfId}.pdf"`);

    renderEcrfPdf(rows[0], res);

    await writeAuditLog(req.user.id, 'EXPORT_ECRF_PDF', 'ecrf_entries', ecrfId, { ecrf_id: ecrfId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
