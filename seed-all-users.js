// One-off script: re-hashes the demo account passwords in place.
// Run with `node seed-all-users.js` after applying schema.sql.
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const config = require('./src/config/env');
const DEFAULT_USERS = require('./src/config/demoUsers');

async function seedUsers() {
  const db = await mysql.createConnection({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database
  });

  for (const u of DEFAULT_USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await db.execute(
      'UPDATE users SET password = ?, role = ? WHERE LOWER(email) = ?',
      [hash, u.role, u.email.toLowerCase()]
    );
    console.log(`Updated user: ${u.email} (${u.role})`);
  }

  console.log('All user passwords successfully hashed and updated!');
  await db.end();
}

seedUsers().catch(console.error);
