const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

async function seedUsers() {
  const db = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Dinesh@22',
    database: 'sih26046_ctms'
  });

  const defaultUsers = [
    { email: 'pi@aiia.gov.in', password: 'PiSecret@2026', role: 'PI' },
    { email: 'crc@aiia.gov.in', password: 'CrcSecret@2026', role: 'CRC' },
    { email: 'auditor@aiia.gov.in', password: 'AuditSecret@2026', role: 'AUDITOR' },
    { email: 'admin@aiia.gov.in', password: 'AdminSecret@2026', role: 'ADMIN' },
    { email: 'ethics@aiia.gov.in', password: 'EthicsSecret@2026', role: 'ETHICS' }
  ];

  for (const u of defaultUsers) {
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