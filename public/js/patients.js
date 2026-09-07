/* ==========================================================================
   Patient registry: trial dropdown, enrolled roster, registration form, and
   the double-blind randomization table.
   ========================================================================== */

const PATIENT_TABLE_COLUMNS = 4;
const RANDOMIZATION_TABLE_COLUMNS = 6;

async function loadPatientModule() {
  await populateTrialSelect();
  await renderPatientRoster();
}

async function populateTrialSelect() {
  const select = document.getElementById('ptTrialSelect');
  if (!select) return;

  try {
    const res = await apiFetch('/api/trials');
    if (!res.ok) return;

    const trials = await res.json();
    select.innerHTML = trials
      .map(t => `<option value="${t.id}">${t.trial_code} - ${t.title}</option>`)
      .join('');
  } catch (err) {
    console.error('Failed to load trials:', err);
  }
}

async function renderPatientRoster() {
  const tbody = document.getElementById('patientTableBody');
  if (!tbody) return;

  renderTableMessage(tbody, PATIENT_TABLE_COLUMNS, 'Loading roster...');

  try {
    const res = await apiFetch('/api/patients');
    if (!res.ok) {
      renderTableMessage(tbody, PATIENT_TABLE_COLUMNS, await readError(res, 'Failed to load patients.'), true);
      return;
    }

    const patients = await res.json();
    if (patients.length === 0) {
      renderTableMessage(tbody, PATIENT_TABLE_COLUMNS, 'No participants enrolled yet.');
      return;
    }

    tbody.innerHTML = patients.map(p => `
      <tr>
        <td><strong>${p.patient_code}</strong></td>
        <td>${p.trial_code || 'N/A'}</td>
        <td>${p.prakriti_baseline || 'N/A'}</td>
        <td>
          ${p.status === 'RANDOMIZED'
            ? '<span class="badge badge-locked">Randomized</span>'
            : `<button class="btn-inline" onclick="triggerRandomization(${p.id})">Randomize</button>`}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    renderTableMessage(tbody, PATIENT_TABLE_COLUMNS, `Error loading roster: ${err.message}`, true);
  }
}

async function loadRandomizationModule() {
  const tbody = document.getElementById('randomizationTableBody');
  if (!tbody) return;

  renderTableMessage(tbody, RANDOMIZATION_TABLE_COLUMNS, 'Loading allocations...');

  try {
    const res = await apiFetch('/api/randomizations');
    if (!res.ok) {
      renderTableMessage(tbody, RANDOMIZATION_TABLE_COLUMNS, await readError(res, 'Failed to load allocations.'), true);
      return;
    }

    const allocations = await res.json();
    if (allocations.length === 0) {
      renderTableMessage(tbody, RANDOMIZATION_TABLE_COLUMNS, 'No subjects randomized yet.');
      return;
    }

    tbody.innerHTML = allocations.map(r => `
      <tr>
        <td><strong>${r.patient_code}</strong></td>
        <td>${r.trial_code}</td>
        <td><code>${r.kit_id}</code></td>
        <td>
          <span class="badge ${r.arm_code === 'BLINDED' ? 'badge-blinded' : 'badge-locked'}">${r.arm_name}</span>
        </td>
        <td>${new Date(r.randomized_at).toLocaleString()}</td>
        <td><small class="text-muted">Allocated</small></td>
      </tr>
    `).join('');
  } catch (err) {
    renderTableMessage(tbody, RANDOMIZATION_TABLE_COLUMNS, `Error loading allocations: ${err.message}`, true);
  }
}

async function triggerRandomization(patientId) {
  if (!confirm('Randomize subject now? A treatment kit will be allocated.')) return;

  try {
    const res = await apiFetch(`/api/patients/${patientId}/randomize`, { method: 'POST' });

    if (!res.ok) {
      alert(`Randomization Failed: ${await readError(res)}`);
      return;
    }

    const data = await res.json();
    alert(`Subject Randomized Successfully!\nAssigned Kit ID: ${data.assigned_kit_id}`);
    loadPatientModule();
    loadRandomizationModule();
  } catch (err) {
    alert(`Network Error: ${err.message}`);
  }
}

function bindPatientForm() {
  const form = document.getElementById('patientForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      trial_id: document.getElementById('ptTrialSelect').value,
      prakriti_baseline: document.getElementById('prakritiSelect').value
    };

    try {
      const res = await apiFetch('/api/patients', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        alert(`Failed to register participant: ${await readError(res)}`);
        return;
      }

      const data = await res.json();
      alert(`Participant registered successfully! Code: ${data.patient_code}`);
      form.reset();
      loadPatientModule();
    } catch (err) {
      alert(`Network Error: ${err.message}`);
    }
  });
}
