const db = require('./pool');

// Tables that are created at boot rather than shipped in schema.sql.
// The rest of the schema is applied manually from schema.sql.
const CREATE_QUERIES_DEVIATIONS = `
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

async function initDb() {
  try {
    await db.query(CREATE_QUERIES_DEVIATIONS);
    console.log('Database tables initialized successfully.');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
}

module.exports = initDb;
