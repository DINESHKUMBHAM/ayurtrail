// --- Global State & Token Helpers ---
function getToken() {
    return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  }
  
  function getCurrentUser() {
    try {
      return JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || 'null');
    } catch (e) {
      return null;
    }
  }
  
  // Authenticated API Fetch Wrapper
  async function apiFetch(url, options = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
  
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  
    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 401) {
      alert('Session expired or unauthorized. Please log in again.');
    }
  
    return response;
  }
  
  // --- Single SPA Navigation Router ---
  function navigate(sectionId) {
    document.querySelectorAll('.page-section').forEach(sec => sec.classList.remove('active'));
    
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
      targetSection.classList.add('active');
    }
  
    // Load modules based on active view
    if (sectionId === 'dashboard') fetchTrials();
    if (sectionId === 'patients') {
      loadPatientModule();
      loadRandomizationModule();
    }
    if (sectionId === 'ecrf') loadEcrfTable();
    if (sectionId === 'pharmacovigilance') loadAEModule();
    if (sectionId === 'audit') fetchAuditLogs();
  }
  
  // --- 1. Trials & Dashboard ---
  async function fetchTrials() {
    const container = document.getElementById('trialList');
    if (!container) return;
  
    try {
      const res = await apiFetch('/api/trials');
      if (!res.ok) return;
  
      const data = await res.json();
      container.innerHTML = data.map(t => `
        <div class="card">
          <h3>${t.trial_code}</h3>
          <p>${t.title}</p>
          <small>Phase: ${t.phase} | Status: <strong>${t.status}</strong></small>
        </div>
      `).join('');
    } catch (err) {
      console.error('Failed to load trials:', err);
    }
  }
  
  // --- 2. Patient Module & Randomization ---
  async function loadPatientModule() {
    try {
      // Populate active trials in dropdown
      const trialRes = await apiFetch('/api/trials');
      if (trialRes.ok) {
        const trials = await trialRes.json();
        const select = document.getElementById('trialSelect') || document.getElementById('ptTrialSelect');
        if (select) {
          select.innerHTML = trials.map(t => `<option value="${t.id}">${t.trial_code} - ${t.title}</option>`).join('');
        }
      }
  
      // Populate patient roster
      const patientRes = await apiFetch('/api/patients');
      const tbody = document.getElementById('patientTableBody');
      if (patientRes.ok && tbody) {
        const patients = await patientRes.json();
        tbody.innerHTML = patients.map(p => `
          <tr>
            <td><strong>${p.patient_code}</strong></td>
            <td>${p.trial_code || 'N/A'}</td>
            <td>${p.prakriti_baseline || 'N/A'}</td>
            <td>
              ${p.status === 'RANDOMIZED' 
                ? `<span class="badge bg-success">Randomized</span>` 
                : `<button class="btn btn-sm btn-primary" onclick="triggerRandomization(${p.id})">Randomize</button>`}
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      console.error('Failed to load patient module:', err);
    }
  }
  
  async function loadRandomizationModule() {
    const tbody = document.getElementById('randomizationTableBody');
    if (!tbody) return;
  
    try {
      const res = await apiFetch('/api/randomizations');
      if (!res.ok) return;
  
      const data = await res.json();
      tbody.innerHTML = data.map(r => `
        <tr>
          <td><strong>${r.patient_code}</strong></td>
          <td>${r.trial_code}</td>
          <td><code>${r.kit_id}</code></td>
          <td>
            <span class="badge ${r.arm_code === 'BLINDED' ? 'bg-warning text-dark' : 'bg-success'}">
              ${r.arm_name}
            </span>
          </td>
          <td>${new Date(r.randomized_at).toLocaleString()}</td>
          <td><small class="text-muted">Allocated</small></td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load randomizations:', err);
    }
  }
  
  async function triggerRandomization(patientId) {
    if (!confirm('Randomize subject now? An unblinded Kit ID will be allocated.')) return;
  
    try {
      const res = await apiFetch(`/api/patients/${patientId}/randomize`, { method: 'POST' });
      const data = await res.json();
  
      if (res.ok) {
        alert(`Subject Randomized Successfully!\nAssigned Kit ID: ${data.assigned_kit_id}`);
        loadPatientModule();
        loadRandomizationModule();
      } else {
        alert(`Randomization Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Network Error: ${err.message}`);
    }
  }
  
  // Patient Registration Form Listener
  const patientForm = document.getElementById('patientForm');
  if (patientForm) {
    patientForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const selectEl = document.getElementById('trialSelect') || document.getElementById('ptTrialSelect');
      const prakritiEl = document.getElementById('prakritiSelect');
  
      const payload = {
        trial_id: selectEl ? selectEl.value : null,
        prakriti_baseline: prakritiEl ? prakritiEl.value : null
      };
  
      const res = await apiFetch('/api/patients', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
  
      if (res.ok) {
        const data = await res.json();
        alert(`Participant registered successfully! Code: ${data.patient_code}`);
        patientForm.reset();
        loadPatientModule();
      } else {
        const err = await res.json();
        alert(`Failed to register participant: ${err.error || 'Unknown error'}`);
      }
    });
  }
  
  // --- 3. eCRF Module & 21 CFR Part 11 Signatures ---
  async function loadEcrfTable() {
    const tableBody = document.getElementById('ecrfTableBody');
    if (!tableBody) return;
  
    tableBody.innerHTML = '<tr><td colspan="7" class="text-center">Loading eCRF records...</td></tr>';
  
    try {
      const response = await apiFetch('/api/ecrf');
      if (!response.ok) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-danger">Failed to retrieve eCRFs.</td></tr>';
        return;
      }
  
      const records = await response.json();
      if (!records || records.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center">No eCRF entries recorded yet.</td></tr>';
        return;
      }
  
      const user = getCurrentUser();
      const canSign = user && ['PI', 'ADMIN'].includes(user.role);
      const token = getToken();
  
      tableBody.innerHTML = records.map(record => {
        const isSigned = Boolean(record.data_hash || record.signature_id);
  
        return `
          <tr>
            <td><strong>#${record.id}</strong></td>
            <td>PAT-${record.patient_id}</td>
            <td>Visit ${record.visit_number || 1}</td>
            <td>${record.anupana_details || 'N/A'}</td>
            <td>
              ${isSigned 
                ? `<span class="badge bg-success">Locked & Signed</span>` 
                : `<span class="badge bg-warning text-dark">Draft / Unsigned</span>`
              }
            </td>
            <td id="verify-status-${record.id}">
              ${isSigned 
                ? `<button class="btn btn-sm btn-outline-info" onclick="checkRecordIntegrity(${record.id})">⚡ Verify Hash</button>` 
                : `<span class="text-muted small">Not Signed</span>`
              }
            </td>
            <td>
              ${isSigned 
                ? `<a href="/api/ecrf/${record.id}/pdf?token=${token}" target="_blank" class="btn btn-sm btn-secondary">📄 View PDF</a>` 
                : (canSign 
                    ? `<button class="btn btn-sm btn-purple" style="background:#7c3aed; color:white;" onclick="signECRF(${record.id})">Sign & Lock</button>`
                    : `<span class="text-muted small">Requires PI Role</span>`)
              }
            </td>
          </tr>
        `;
      }).join('');
  
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="7" class="text-danger">Error loading eCRF records: ${err.message}</td></tr>`;
    }
  }
  
  // Record Hash Integrity Check
  async function checkRecordIntegrity(ecrfId) {
    const statusCell = document.getElementById(`verify-status-${ecrfId}`);
    if (!statusCell) return;
  
    statusCell.innerHTML = `<span class="spinner-border spinner-border-sm text-primary"></span> Checking...`;
  
    try {
      const response = await apiFetch(`/api/ecrf/${ecrfId}/verify`);
      const data = await response.json();
  
      if (response.status === 200 && data.status === 'VERIFIED') {
        statusCell.innerHTML = `
          <span class="badge bg-success p-2" title="Signed by ${data.signed_by}">
            ✓ VERIFIED (Authentic)
          </span>
          <button class="btn btn-sm btn-link p-0 ms-1" onclick="checkRecordIntegrity(${ecrfId})">🔄</button>
        `;
      } else if (response.status === 409 || data.status === 'TAMPER_DETECTED') {
        statusCell.innerHTML = `
          <span class="badge bg-danger p-2" title="Hash mismatch!">
            ⚠️ TAMPER DETECTED
          </span>
          <button class="btn btn-sm btn-link p-0 ms-1" onclick="checkRecordIntegrity(${ecrfId})">🔄</button>
        `;
        alert(`CRITICAL ALERT: Data integrity breach detected on eCRF #${ecrfId}.\n\nStored Hash: ${data.stored_hash}\nCalculated Hash: ${data.recalculated_hash}`);
      } else {
        statusCell.innerHTML = `<span class="badge bg-secondary p-2">Error: ${data.error || 'Failed'}</span>`;
      }
    } catch (err) {
      statusCell.innerHTML = `<span class="badge bg-danger">Network Error</span>`;
    }
  }
  
  // Electronic Signature Handler (21 CFR Part 11 Re-Authentication)
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
          password: password
        })
      });
  
      const data = await res.json();
      if (res.ok) {
        alert('Record electronically signed and locked successfully.');
        loadEcrfTable();
      } else {
        alert(`Signing failed: ${data.error || 'Invalid Credentials'}`);
      }
    } catch (err) {
      alert(`Signing error: ${err.message}`);
    }
  }
  
  // eCRF Draft Form Listener
  const ecrfForm = document.getElementById('ecrfForm');
  if (ecrfForm) {
    ecrfForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        patient_id: document.getElementById('p_id').value,
        visit_number: document.getElementById('v_num').value,
        dosha_data: { primary_imbalance: document.getElementById('dosha').value },
        anupana_details: document.getElementById('anupana').value
      };
  
      const res = await apiFetch('/api/ecrf', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
  
      if (res.ok) {
        alert('eCRF Draft successfully logged!');
        ecrfForm.reset();
        loadEcrfTable();
      } else {
        const err = await res.json();
        alert(`Failed to save eCRF: ${err.error || 'Server Error'}`);
      }
    });
  }
  
  // --- 4. Pharmacovigilance / Safety Module ---
  async function loadAEModule() {
    const container = document.getElementById('aeList');
    if (!container) return;
  
    try {
      const res = await apiFetch('/api/pharmacovigilance');
      if (!res.ok) return;
  
      const data = await res.json();
      container.innerHTML = data.map(ae => `
        <div style="border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 8px;">
          <strong>${ae.patient_code}</strong> (${ae.trial_code})
          <span class="badge ${ae.severity === 'SAE' || ae.severity === 'SEVERE' ? 'bg-danger' : 'bg-warning text-dark'}">${ae.severity}</span>
          <p style="margin: 4px 0;">Suspected Herb: <strong>${ae.suspected_herb}</strong></p>
          <small>${ae.symptom_description}</small>
        </div>
      `).join('');
    } catch (err) {
      console.error('Failed to load safety events:', err);
    }
  }
  
  const aeForm = document.getElementById('aeForm');
  if (aeForm) {
    aeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        patient_id: document.getElementById('aePatientId').value,
        trial_id: document.getElementById('aeTrialId').value,
        severity: document.getElementById('aeSeverity').value,
        suspected_herb: document.getElementById('aeHerb').value,
        symptom_description: document.getElementById('aeSymptom').value
      };
  
      const res = await apiFetch('/api/pharmacovigilance', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
  
      if (res.ok) {
        alert('Adverse Event reported successfully.');
        aeForm.reset();
        loadAEModule();
      } else {
        const err = await res.json();
        alert(`Failed to submit AE: ${err.error || 'Server Error'}`);
      }
    });
  }
  
  // --- 5. Audit Trail & Data Exports ---
  async function fetchAuditLogs() {
    const tbody = document.querySelector('#auditTable tbody') || document.getElementById('auditTableBody');
    if (!tbody) return;
  
    try {
      const res = await apiFetch('/api/audit');
      if (!res.ok) return;
  
      const logs = await res.json();
      tbody.innerHTML = logs.map(l => `
        <tr>
          <td>${new Date(l.timestamp).toLocaleString()}</td>
          <td>User #${l.user_id}</td>
          <td><strong>${l.action}</strong></td>
          <td>${l.target_table}</td>
          <td><code>${JSON.stringify(l.payload)}</code></td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    }
  }
  
  function exportData(type) {
    const token = getToken();
    window.open(`/api/export/${type}?token=${token}`, '_blank');
  }
  
  // Initial View Load
  document.addEventListener('DOMContentLoaded', () => {
    navigate('dashboard');
  });