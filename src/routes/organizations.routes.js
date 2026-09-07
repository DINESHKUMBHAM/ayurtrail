const express = require('express');

const db = require('../db/pool');
const { authenticateToken, requireRole } = require('../middleware/auth');
const writeAuditLog = require('../utils/audit');

const router = express.Router();

const VALID_TYPES = ['ACADEMIC', 'HOSPITAL', 'CRO', 'GOVERNMENT', 'INDUSTRY'];
const VALID_STATUSES = ['ACTIVE', 'INACTIVE'];

// GET /api/organizations
// ?status=ACTIVE filters to participating sites only; the UI defaults to that.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const requested = String(req.query.status || '').trim().toUpperCase();

    let sql = 'SELECT * FROM research_organizations';
    const params = [];
    if (VALID_STATUSES.includes(requested)) {
      sql += ' WHERE status = ?';
      params.push(requested);
    }
    sql += ' ORDER BY status ASC, name ASC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/organizations -- register a participating research organization.
router.post('/', authenticateToken, requireRole('PI', 'ADMIN'), async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { org_code, name, org_type, city, contact_email, status } = req.body;

    const code = String(org_code || '').trim();
    const orgName = String(name || '').trim();
    const type = String(org_type || '').trim().toUpperCase();
    const orgStatus = String(status || 'ACTIVE').trim().toUpperCase();
    const orgCity = city ? String(city).trim() : null;
    const email = contact_email ? String(contact_email).trim() : null;

    if (!code) {
      await connection.rollback();
      return res.status(400).json({ error: 'Organization code is required.' });
    }
    if (!orgName) {
      await connection.rollback();
      return res.status(400).json({ error: 'Organization name is required.' });
    }
    if (!VALID_TYPES.includes(type)) {
      await connection.rollback();
      return res.status(400).json({ error: `Invalid organization type. Expected one of: ${VALID_TYPES.join(', ')}.` });
    }
    if (!VALID_STATUSES.includes(orgStatus)) {
      await connection.rollback();
      return res.status(400).json({ error: `Invalid status. Expected one of: ${VALID_STATUSES.join(', ')}.` });
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Contact email is not a valid address.' });
    }

    const [existing] = await connection.query(
      'SELECT id FROM research_organizations WHERE UPPER(TRIM(org_code)) = ?',
      [code.toUpperCase()]
    );
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(409).json({ error: `Organization code "${code}" already exists.` });
    }

    const [result] = await connection.execute(
      `INSERT INTO research_organizations (org_code, name, org_type, city, contact_email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, orgName, type, orgCity, email, orgStatus]
    );

    await writeAuditLog(req.user.id, 'REGISTER_ORGANIZATION', 'research_organizations', result.insertId, {
      org_code: code,
      name: orgName,
      org_type: type,
      city: orgCity,
      status: orgStatus
    });

    await connection.commit();
    res.status(201).json({ status: 'Success', id: result.insertId, org_code: code });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
