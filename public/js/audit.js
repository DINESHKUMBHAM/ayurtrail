/* ==========================================================================
   Audit trail viewer and regulatory CSV exports.
   ========================================================================== */

const AUDIT_TABLE_COLUMNS = 5;

async function fetchAuditLogs() {
  const tbody = document.getElementById('auditTableBody');
  if (!tbody) return;

  renderTableMessage(tbody, AUDIT_TABLE_COLUMNS, 'Loading audit trail...');

  try {
    const res = await apiFetch('/api/audit');
    if (!res.ok) {
      renderTableMessage(tbody, AUDIT_TABLE_COLUMNS, await readError(res, 'Failed to load audit trail.'), true);
      return;
    }

    const logs = await res.json();
    if (logs.length === 0) {
      renderTableMessage(tbody, AUDIT_TABLE_COLUMNS, 'No audit entries recorded.');
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td><small>${new Date(l.timestamp).toLocaleString()}</small></td>
        <td>User #${l.user_id}</td>
        <td><span class="badge badge-locked">${l.action}</span></td>
        <td><code>${l.target_table}</code></td>
        <td><pre class="payload-cell">${JSON.stringify(l.payload)}</pre></td>
      </tr>
    `).join('');
  } catch (err) {
    renderTableMessage(tbody, AUDIT_TABLE_COLUMNS, `Error loading audit trail: ${err.message}`, true);
  }
}

// The CSV is generated server-side. A new tab cannot carry an Authorization
// header, so the token goes in the query string (see authenticateToken).
function exportData(type) {
  const token = getToken();
  window.open(`/api/export/${type}?token=${encodeURIComponent(token)}`, '_blank');
}
