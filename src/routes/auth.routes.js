const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const db = require('../db/pool');
const config = require('../config/env');
const writeAuditLog = require('../utils/audit');

const router = express.Router();

// POST /api/login
router.post('/login', async (req, res) => {
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

    const token = jwt.sign(tokenPayload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

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

module.exports = router;
