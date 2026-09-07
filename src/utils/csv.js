// Serializes result rows to CSV. Every value is quoted; object values (JSON
// columns such as audit_logs.payload) are stringified with embedded quotes doubled.
function rowsToCsv(rows) {
  const headers = Object.keys(rows[0]).join(',') + '\n';

  const body = rows.map(row =>
    Object.values(row)
      .map(val => typeof val === 'object'
        ? `"${JSON.stringify(val).replace(/"/g, '""')}"`
        : `"${val}"`)
      .join(',')
  ).join('\n');

  return headers + body;
}

module.exports = { rowsToCsv };
