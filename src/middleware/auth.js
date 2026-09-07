const jwt = require('jsonwebtoken');
const config = require('../config/env');

// Verifies the bearer token and attaches the decoded user to req.user.
// The ?token= query fallback exists so that browser-initiated downloads
// (PDF export, CSV export) can authenticate without custom headers.
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) return res.status(401).json({ error: 'Access token required.' });

  jwt.verify(token, config.jwtSecret, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session expired or invalid token.' });
    req.user = user;
    next();
  });
}

// Must be used after authenticateToken.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access forbidden for role: ${req.user ? req.user.role : 'Guest'}` });
    }
    next();
  };
}

module.exports = { authenticateToken, requireRole };
