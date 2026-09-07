const db = require('./pool');
const config = require('../config/env');

// Columns the analytics dashboard needs that the original schema never had.
// Without enrolled_at there is nothing to measure recruitment against, and
// without target_enrollment there is no finish line to project a completion
// date towards.
const REQUIRED_COLUMNS = [
  {
    table: 'patients',
    column: 'enrolled_at',
    // Deliberately no DEFAULT: ADD COLUMN with a default backfills existing
    // rows, which would stamp every historical patient with the migration
    // time and spike recruitment velocity. Pre-existing rows stay NULL
    // (enrolment date genuinely unknown); new rows set it explicitly.
    definition: 'DATETIME NULL',
    reason: 'recruitment velocity'
  },
  {
    table: 'trials',
    column: 'target_enrollment',
    definition: 'INT NULL',
    reason: 'estimated trial completion'
  },
  {
    table: 'trials',
    column: 'start_date',
    definition: 'DATE NULL',
    reason: 'trial duration reporting'
  }
];

async function columnExists(table, column) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [config.db.database, table, column]
  );
  return rows.length > 0;
}

async function tableExists(table) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`,
    [config.db.database, table]
  );
  return rows.length > 0;
}

// MySQL has no ADD COLUMN IF NOT EXISTS, so each column is checked against
// information_schema first. Safe to run on every boot.
async function runMigrations() {
  for (const { table, column, definition, reason } of REQUIRED_COLUMNS) {
    try {
      if (!(await tableExists(table))) {
        console.warn(`Migration skipped: table "${table}" does not exist (needed for ${reason}).`);
        continue;
      }
      if (await columnExists(table, column)) continue;

      await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      console.log(`Migration applied: ${table}.${column} added (${reason}).`);
    } catch (err) {
      console.error(`Migration failed for ${table}.${column}:`, err.message);
    }
  }
}

module.exports = { runMigrations, columnExists, tableExists };
