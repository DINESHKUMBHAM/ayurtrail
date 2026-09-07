const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');

const app = express();
const JWT_SECRET = 'sih26046_super_secret_jwt_key_2026';

// MySQL Connection Pool
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'Dinesh@22',
  database: 'sih26046_ctms',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize MySQL Tables
async function initDb() {
  try {
    const createQueriesTable = `
      CREATE TABLE IF NOT EXISTS queries_deviations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        trial_id INT NOT NULL,
        patient_id INT NOT NULL,
        category ENUM('PROTOCOL_DEVIATION', 'DATA_QUERY', 'ELIGIBILITY_VIOLATION') NOT NULL,
        description TEXT NOT NULL,
        severity ENUM('MINOR', 'MAJOR', 'CRITICAL') NOT NULL,
        status ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED') DEFAULT 'OPEN',
        resolution_notes TEXT,
        raised_by VARCHAR(255) NOT NULL,
        resolved_by VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `;
    await db.query(createQueriesTable);
    console.log('Database tables initialized successfully.');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
}
initDb();

// Audit Trail Helper
async function writeAuditLog(userId, action, table, recordId, payload) {
  const query = `INSERT INTO audit_logs (user_id, action, target_table, record_id, payload) VALUES (?, ?, ?, ?, ?)`;
  await db.execute(query, [userId, action, table, recordId, JSON.stringify(payload)]);
}

// Input Sanitization & Validation Helper
function validateId(id, name = 'ID') {
  const parsed = parseInt(id, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: Must be a positive integer.`);
  }
  return parsed;
}

// Helper to guarantee identical hash string across sign and verify
function generateCanonicalHashPayload(record, signerId) {
  const doshaData = typeof record.dosha_data === 'string' 
    ? JSON.parse(record.dosha_data) 
    : (record.dosha_data || {});

  const normalizedObject = {
    id: Number(record.id),
    patient_id: Number(record.patient_id),
    visit_number: Number(record.visit_number),
    dosha_data: doshaData,
    anupana_details: record.anupana_details || ''
  };

  return JSON.stringify(normalizedObject) + Number(signerId);
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) return res.status(401).json({ error: 'Access token required.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session expired or invalid token.' });
    req.user = user;
    next();
  });
}

// Role Authorization Helper
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access forbidden for role: ${req.user ? req.user.role : 'Guest'}` });
    }
    next();
  };
}

// 1. Login Route
app.post('/api/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    console.log('--- LOGIN TRY ---', { email, password, role });

    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role are required.' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    
    if (rows.length === 0) {
      console.log('REASON: Email not found in database.');
      return res.status(401).json({ error: 'Invalid credentials or role mismatch.' });
    }

    const user = rows[0];
    console.log('DB USER FOUND:', { db_email: user.email, db_role: user.role });

    if (user.role.trim().toUpperCase() !== role.trim().toUpperCase()) {
      console.log(`REASON: Role mismatch! DB has "${user.role}", request sent "${role}"`);
      return res.status(401).json({ error: 'Invalid credentials or role mismatch.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('REASON: Password does not match bcrypt hash.');
      return res.status(401).json({ error: 'Invalid credentials or role mismatch.' });
    }

    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });

    await writeAuditLog(user.id, 'USER_LOGIN', 'users', user.id, { email: user.email, role: user.role });

    console.log(`SUCCESS: User ${user.email} logged in as ${user.role}`);

    return res.json({
      status: 'Success',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

// 2. Fetch Trials
app.get('/api/trials', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM trials ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Fetch & Register Patients
app.get('/api/patients', authenticateToken, async (req, res) => {
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

app.post('/api/patients', authenticateToken, requireRole('PI', 'CRC', 'ADMIN'), async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { trial_id, prakriti_baseline } = req.body;
    
    const validTrialId = validateId(trial_id, 'Trial ID');
    if (!prakriti_baseline || typeof prakriti_baseline !== 'string') {
      return res.status(400).json({ error: 'Invalid Prakriti baseline value.' });
    }

    const patientCode = `PAT-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const [result] = await connection.execute(
      `INSERT INTO patients (patient_code, trial_id, prakriti_baseline, status) VALUES (?, ?, ?, 'ENROLLED')`,
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

// 4. eCRF Operations
app.get('/api/ecrf', authenticateToken, async (req, res) => {
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

app.post('/api/ecrf', authenticateToken, requireRole('PI', 'CRC'), async (req, res) => {
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

// 4b. Update eCRF Record (with 21 CFR Part 11 Immutability Guard)
app.put('/api/ecrf/:id', authenticateToken, requireRole('PI', 'CRC'), async (req, res) => {
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

// 5. 21 CFR Part 11 Electronic Signature with Mandatory Re-Authentication
app.post('/api/ecrf/:id/sign', authenticateToken, requireRole('PI', 'ADMIN'), async (req, res) => {
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

    const payloadString = generateCanonicalHashPayload(ecrfRows[0], req.user.id);
    const dataHash = crypto.createHash('sha256').update(payloadString).digest('hex');

    await connection.execute(
      `INSERT INTO ecrf_signatures (ecrf_id, signer_id, signature_reason, data_hash) VALUES (?, ?, ?, ?)`,
      [ecrfId, req.user.id, signature_reason || 'Attestation of Clinical Trial Data Accuracy', dataHash]
    );

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

// 5b. Enhanced Hash Verification Endpoint with Field-Level Tamper Detection
app.get('/api/ecrf/:id/verify', authenticateToken, requireRole('AUDITOR', 'ETHICS', 'PI', 'ADMIN'), async (req, res) => {
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

    const currentPayloadString = generateCanonicalHashPayload(record, record.signer_id);
    const recalculatedHash = crypto.createHash('sha256').update(currentPayloadString).digest('hex');
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

// 5c. PDF Export with 21 CFR Part 11 Signature Banner
app.get('/api/ecrf/:id/pdf', authenticateToken, async (req, res) => {
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

    const record = rows[0];
    const doc = new PDFDocument({ margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="eCRF_Record_${ecrfId}.pdf"`);

    doc.pipe(res);

    doc.fontSize(18).text('AIIA Clinical Trial Management System', { align: 'center' });
    doc.fontSize(12).text('Electronic Case Report Form (eCRF)', { align: 'center' });
    doc.moveDown();

    if (record.data_hash) {
      doc.rect(35, doc.y, 540, 75).fillAndStroke('#e6f4ea', '#137333');
      doc.fillColor('#137333').fontSize(11).text('VERIFIED 21 CFR PART 11 ELECTRONIC SIGNATURE', 45, doc.y - 65, { bold: true });
      doc.fillColor('#000000').fontSize(9)
        .text(`Signed By: ${record.signer_name} (${record.signer_role})`)
        .text(`Reason: ${record.signature_reason}`)
        .text(`Timestamp: ${record.signed_at}`)
        .text(`SHA-256 Hash: ${record.data_hash}`);
      doc.moveDown(2);
    } else {
      doc.rect(35, doc.y, 540, 35).fillAndStroke('#fff0f0', '#c5221f');
      doc.fillColor('#c5221f').fontSize(11).text('DRAFT RECORD - NOT ELECTRONICALLY SIGNED', 45, doc.y - 25);
      doc.moveDown(2);
    }

    doc.fillColor('#000000').fontSize(12).text(`Record ID: ${record.id}`);
    doc.text(`Patient Code: ${record.patient_code}`);
    doc.text(`Visit Number: ${record.visit_number}`);
    doc.text(`Recorded Date: ${record.created_at}`);
    doc.moveDown();

    doc.fontSize(14).text('Clinical Data Details:');
    doc.fontSize(10).text(`Dosha Assessment Data: ${JSON.stringify(record.dosha_data, null, 2)}`);
    doc.text(`Anupana Details: ${record.anupana_details || 'N/A'}`);

    doc.end();

    await writeAuditLog(req.user.id, 'EXPORT_ECRF_PDF', 'ecrf_entries', ecrfId, { ecrf_id: ecrfId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Pharmacovigilance
app.post('/api/pharmacovigilance', authenticateToken, async (req, res) => {
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

app.get('/api/pharmacovigilance', authenticateToken, async (req, res) => {
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

// 7. Audit Trail
app.get('/api/audit', authenticateToken, requireRole('AUDITOR', 'ETHICS', 'PI', 'ADMIN'), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Regulatory Exports
app.get('/api/export/:type', authenticateToken, requireRole('AUDITOR', 'ETHICS', 'PI', 'ADMIN'), async (req, res) => {
  try {
    const { type } = req.params;
    let query = '';
    let filename = `${type}_export_${Date.now()}.csv`;

    if (type === 'safety') {
      query = `
        SELECT ae.id, COALESCE(p.patient_code, 'N/A') AS patient_code, COALESCE(t.trial_code, 'N/A') AS trial_code, 
               ae.severity, ae.suspected_herb, ae.symptom_description, ae.reported_at 
        FROM adverse_events ae 
        LEFT JOIN patients p ON ae.patient_id = p.id 
        LEFT JOIN trials t ON ae.trial_id = t.id
        ORDER BY ae.reported_at DESC
      `;
    } else if (type === 'patients') {
      query = `SELECT p.id, p.patient_code, t.trial_code, p.prakriti_baseline, p.status FROM patients p JOIN trials t ON p.trial_id = t.id`;
    } else if (type === 'audit') {
      query = `SELECT * FROM audit_logs ORDER BY timestamp DESC`;
    } else {
      return res.status(400).json({ error: 'Invalid export type.' });
    }

    const [rows] = await db.query(query);
    if (rows.length === 0) {
      let defaultHeaders = '';
      if (type === 'safety') {
        defaultHeaders = 'id,patient_code,trial_code,severity,suspected_herb,symptom_description,reported_at\n';
      } else {
        return res.status(404).send('No records found.');
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(defaultHeaders);
    }

    const headers = Object.keys(rows[0]).join(',') + '\n';
    const csvData = rows.map(row => 
      Object.values(row).map(val => typeof val === 'object' ? `"${JSON.stringify(val).replace(/"/g, '""')}"` : `"${val}"`).join(',')
    ).join('\n');

    await writeAuditLog(req.user.id, 'EXPORT_DATA', type, 0, { type });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(headers + csvData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Double-Blind Randomization
app.post('/api/patients/:id/randomize', authenticateToken, requireRole('PI', 'CRC'), async (req, res) => {
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

app.get('/api/randomizations', authenticateToken, async (req, res) => {
  try {
    const isUnblinded = ['AUDITOR', 'ETHICS', 'ADMIN'].includes(req.user.role);
    
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

// 10. Aggregated KPI Dashboard Endpoint
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
      const [
        [activeTrials],
        [totalPatients],
        [pendingSignatures],
        [activeSAE],
        [prakritiDist],
        [recentTrials]
      ] = await Promise.all([
        db.query(`SELECT COUNT(*) AS count FROM trials WHERE status = 'ACTIVE' OR status = 'OPEN'`),
        db.query(`SELECT COUNT(*) AS count FROM patients`),
        db.query(`
          SELECT COUNT(*) AS count 
          FROM ecrf_entries e 
          LEFT JOIN ecrf_signatures s ON e.id = s.ecrf_id 
          WHERE s.id IS NULL
        `),
        db.query(`SELECT COUNT(*) AS count FROM adverse_events WHERE UPPER(TRIM(severity)) IN ('SAE', 'SEVERE', 'CRITICAL')`),
        db.query(`SELECT prakriti_baseline AS dosha, COUNT(*) AS count FROM patients GROUP BY prakriti_baseline`),
        db.query(`SELECT id, trial_code, title, phase, status FROM trials ORDER BY id DESC LIMIT 6`)
      ]);
  
      res.json({
        summary: {
          active_trials: activeTrials[0].count,
          total_patients: totalPatients[0].count,
          pending_signatures: pendingSignatures[0].count,
          active_sae: activeSAE[0].count
        },
        prakriti_distribution: prakritiDist,
        trials: recentTrials
      });
    } catch (err) {
      console.error('KPI Dashboard Error:', err);
      res.status(500).json({ error: 'Failed to retrieve dashboard metrics.' });
    }
  });

// 11. Queries & Deviations Operations (Converted to MySQL async/await)
app.get('/api/queries', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT q.*, t.trial_code FROM queries_deviations q JOIN trials t ON q.trial_id = t.id ORDER BY q.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/queries', authenticateToken, async (req, res) => {
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

app.put('/api/queries/:id/resolve', authenticateToken, async (req, res) => {
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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`AIIA CTMS Server (21 CFR Part 11 Active) running at http://localhost:${PORT}`);
});