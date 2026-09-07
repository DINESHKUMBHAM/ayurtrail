const express = require('express');

const db = require('../db/pool');
const { authenticateToken, requireRole } = require('../middleware/auth');
const writeAuditLog = require('../utils/audit');

const router = express.Router();

const VALID_CATEGORIES = ['BUG', 'FEATURE_REQUEST', 'DATA_ISSUE', 'TRAINING', 'OTHER'];
const MAX_SUBJECT = 255;
const MAX_MESSAGE = 5000;

// POST /api/feedback -- any authenticated user may raise a support request.
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { category, subject, message } = req.body;

    const cat = String(category || '').trim().toUpperCase();
    const subj = String(subject || '').trim();
    const body = String(message || '').trim();

    if (!VALID_CATEGORIES.includes(cat)) {
      return res.status(400).json({ error: `Invalid category. Expected one of: ${VALID_CATEGORIES.join(', ')}.` });
    }
    if (!subj) {
      return res.status(400).json({ error: 'Subject is required.' });
    }
    if (subj.length > MAX_SUBJECT) {
      return res.status(400).json({ error: `Subject must be ${MAX_SUBJECT} characters or fewer.` });
    }
    if (!body) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    if (body.length > MAX_MESSAGE) {
      return res.status(400).json({ error: `Message must be ${MAX_MESSAGE} characters or fewer.` });
    }

    const [result] = await db.execute(
      `INSERT INTO feedback_submissions (user_id, category, subject, message) VALUES (?, ?, ?, ?)`,
      [req.user.id, cat, subj, body]
    );

    await writeAuditLog(req.user.id, 'SUBMIT_FEEDBACK', 'feedback_submissions', result.insertId, {
      category: cat,
      subject: subj
    });

    res.status(201).json({ status: 'Success', id: result.insertId, message: 'Support request submitted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feedback -- triage view, restricted to system administrators.
router.get('/', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT f.*, u.name AS submitted_by, u.role AS submitter_role
       FROM feedback_submissions f
       LEFT JOIN users u ON f.user_id = u.id
       ORDER BY f.created_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
