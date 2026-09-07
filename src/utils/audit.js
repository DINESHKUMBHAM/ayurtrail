const db = require('../db/pool');

// Appends to the immutable audit trail.
//
// NOTE: this deliberately uses the pool rather than a caller-supplied
// transaction connection, matching the behaviour before the split -- audit rows
// are written outside the caller's transaction and therefore survive a rollback.
async function writeAuditLog(userId, action, table, recordId, payload) {
  const query = `INSERT INTO audit_logs (user_id, action, target_table, record_id, payload) VALUES (?, ?, ?, ?, ?)`;
  await db.execute(query, [userId, action, table, recordId, JSON.stringify(payload)]);
}

module.exports = writeAuditLog;
