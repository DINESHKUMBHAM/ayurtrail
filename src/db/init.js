const db = require('./pool');

// Tables created at boot rather than shipped in schema.sql.
// The rest of the schema is applied manually from schema.sql.
const BOOT_TABLES = [
  {
    name: 'queries_deviations',
    sql: `
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
    `
  },
  {
    name: 'research_organizations',
    sql: `
      CREATE TABLE IF NOT EXISTS research_organizations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        org_code VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        org_type ENUM('ACADEMIC', 'HOSPITAL', 'CRO', 'GOVERNMENT', 'INDUSTRY') NOT NULL,
        city VARCHAR(120),
        contact_email VARCHAR(255),
        status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `
  },
  {
    name: 'feedback_submissions',
    sql: `
      CREATE TABLE IF NOT EXISTS feedback_submissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        category ENUM('BUG', 'FEATURE_REQUEST', 'DATA_ISSUE', 'TRAINING', 'OTHER') NOT NULL,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        status ENUM('OPEN', 'IN_PROGRESS', 'CLOSED') DEFAULT 'OPEN',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `
  }
];

async function initDb() {
  for (const { name, sql } of BOOT_TABLES) {
    try {
      await db.query(sql);
    } catch (err) {
      console.error(`Error initializing table "${name}":`, err.message);
    }
  }
  console.log('Database tables initialized successfully.');
}

module.exports = initDb;
