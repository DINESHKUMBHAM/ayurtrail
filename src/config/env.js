// Central configuration. Values fall back to the literals that were previously
// hardcoded in server.js so `npm start` keeps working with no .env present.
// Move JWT_SECRET and DB_PASSWORD into a real .env before this leaves a laptop.

const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  jwtSecret: process.env.JWT_SECRET || 'sih26046_super_secret_jwt_key_2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',

  db: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Dinesh@22',
    database: process.env.DB_NAME || 'sih26046_ctms',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_POOL_LIMIT || '10', 10),
    queueLimit: 0
  }
};

module.exports = config;
