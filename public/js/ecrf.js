/* ==========================================================================
   eCRF module: draft capture, the record table, 21 CFR Part 11 signing with
   password re-authentication, and hash verification.
   ========================================================================== */

const ECRF_TABLE_COLUMNS = 7;
const SIGNING_ROLES = ['PI', 'ADMIN'];

async function loadEcrfTable() {
  const tbody = document.getElementById('ecrfTableBody');
  if (!tbody) return;

  renderTableMessage(tbody, ECRF_TABLE_COLUMNS, 'Loading eCRF records...');

  try {
    const res = await apiFetch('/api/ecrf');
    if (!res.ok) {
      renderTableMessage(tbody, ECRF_TABLE_COLUMNS, await readError(res, 'Failed to retrieve eCRFs.'), true);
      return;
    }

    const records = await res.json();
    if (!records || records.length === 0) {
      renderTableMessage(tbody, ECRF_TABLE_COLUMNS, 'No eCRF entries recorded yet.');
      return;
    }

    const user = getCurrentUser();
    const canSign = Boolean(user && SIGNING_ROLES.includes(user.role));
    const token = getToken();

    tbody.innerHTML = records.map(record => renderEcrfRow(record, canSign, token)).join('');
  } catch (err) {
    renderTableMessage(tbody, ECRF_TABLE_COLUMNS, `Error loading eCRF records: ${err.message}`, true);
  }
}

function renderEcrfRow(record, canSign, token) {
  const isSigned = Boolean(record.data_hash || record.signature_id);

  const integrityCell = isSigned
    ? `<button class="btn-verify" onclick="checkRecordIntegrity(${record.id})">⚡ Verify Hash</button>`
    : '<span class="text-muted text-small">Not Signed</span>';

  let actionCell;
  if (isSigned) {
    // The PDF opens in a new tab, so the token rides along in the query string.
    actionCell = `<a href="/api/ecrf/${record.id}/pdf?token=${encodeURIComponent(token)}" target="_blank" class="btn-pdf">📄 View PDF</a>`;
  } else if (canSign) {
    actionCell = `<button class="btn-sign" onclick="signECRF(${record.id})">Sign &amp; Lock</button>`;
  } else {
    actionCell = '<span class="text-muted text-small">Requires PI Role</span>';
  }

  return `
    <tr>
      <td><strong>#${record.id}</strong></td>
      <td>PAT-${record.patient_id}</td>
      <td>Visit ${record.visit_number || 1}</td>
      <td>${record.anupana_details || 'N/A'}</td>
      <td>
        ${isSigned
          ? '<span class="badge badge-locked">Locked &amp; Signed</span>'
          : '<span class="badge badge-open">Draft / Unsigned</span>'}
      </td>
      <td id="verify-status-${record.id}">${integrityCell}</td>
      <td>${actionCell}</td>
    </tr>
  `;
}

async function checkRecordIntegrity(ecrfId) {
  const statusCell = document.getElementById(`verify-status-${ecrfId}`);
  if (!statusCell) return;

  statusCell.innerHTML = '<span class="spinner"></span> Checking...';
  const retryButton = `<button class="btn-refresh" onclick="checkRecordIntegrity(${ecrfId})">🔄</button>`;

  try {
    const res = await apiFetch(`/api/ecrf/${ecrfId}/verify`);
    const data = await res.json();

    if (res.status === 200 && data.status === 'VERIFIED') {
      statusCell.innerHTML = `<span class="badge badge-verified" title="Signed by ${data.signed_by}">✓ VERIFIED</span>${retryButton}`;
    } else if (res.status === 409 || data.status === 'TAMPER_DETECTED') {
      statusCell.innerHTML = `<span class="badge badge-tampered" title="Hash mismatch">⚠️ TAMPER DETECTED</span>${retryButton}`;
      alert(`CRITICAL ALERT: Data integrity breach detected on eCRF #${ecrfId}.\n\nStored Hash: ${data.stored_hash}\nCalculated Hash: ${data.recalculated_hash}`);
    } else {
      statusCell.innerHTML = `<span class="badge badge-neutral">Error: ${data.error || 'Failed'}</span>${retryButton}`;
    }
  } catch (err) {
    statusCell.innerHTML = `<span class="badge badge-tampered">Network Error</span>${retryButton}`;
  }
}

// 21 CFR Part 11 requires the signer to re-enter credentials at signing time,
// even though they already hold a valid session token.
async function signECRF(ecrfId) {
  const user = getCurrentUser();
  const password = prompt(`21 CFR Part 11 Re-Authentication (${user ? user.role : 'PI'}):\n\nEnter your password to electronically sign and permanently lock record #${ecrfId}:`);

  if (!password) {
    alert('Signature canceled.');
    return;
  }

  try {
    const res = await apiFetch(`/api/ecrf/${ecrfId}/sign`, {
      method: 'POST',
      body: JSON.stringify({
        signature_reason: 'PI Attestation & Data Lock',
        password
      })
    });

    if (!res.ok) {
      alert(`Signing failed: ${await readError(res, 'Invalid credentials')}`);
      return;
    }

    alert('Record electronically signed and locked successfully.');
    loadEcrfTable();
  } catch (err) {
    alert(`Signing error: ${err.message}`);
  }
}

function bindEcrfForm() {
  const form = document.getElementById('ecrfForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      patient_id: document.getElementById('p_id').value,
      visit_number: document.getElementById('v_num').value,
      dosha_data: { primary_imbalance: document.getElementById('dosha').value },
      anupana_details: document.getElementById('anupana').value
    };

    try {
      const res = await apiFetch('/api/ecrf', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        alert(`Failed to save eCRF: ${await readError(res, 'Server Error')}`);
        return;
      }

      alert('eCRF Draft successfully logged!');
      form.reset();
      loadEcrfTable();
    } catch (err) {
      alert(`Network Error: ${err.message}`);
    }
  });
}
