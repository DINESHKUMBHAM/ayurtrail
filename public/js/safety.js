/* ==========================================================================
   Pharmacovigilance: adverse event reporting and the active safety log.
   ========================================================================== */

// Severities that count as serious and raise the system-wide alert banner.
const SERIOUS_SEVERITIES = ['SEVERE', 'SAE', 'CRITICAL'];

function isSerious(severity) {
  return SERIOUS_SEVERITIES.includes(String(severity || '').trim().toUpperCase());
}

async function loadAEModule() {
  const container = document.getElementById('aeList');
  if (!container) return;

  container.innerHTML = '<p class="text-muted">Loading safety events...</p>';

  try {
    const res = await apiFetch('/api/pharmacovigilance');
    if (!res.ok) {
      container.innerHTML = `<p class="text-danger">${await readError(res, 'Failed to load safety events.')}</p>`;
      return;
    }

    const events = await res.json();
    if (events.length === 0) {
      container.innerHTML = '<p class="text-muted">No adverse events reported.</p>';
      return;
    }

    container.innerHTML = events.map(ae => `
      <div class="ae-entry${isSerious(ae.severity) ? ' is-serious' : ''}">
        <div class="ae-entry-header">
          <strong>${ae.patient_code} (${ae.trial_code}) - ${ae.suspected_herb}</strong>
          <span class="badge ${isSerious(ae.severity) ? 'badge-sae' : 'badge-ae'}">${ae.severity}</span>
        </div>
        <p>${ae.symptom_description}</p>
        <small class="text-light text-tiny">Reported: ${new Date(ae.reported_at).toLocaleString()}</small>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="text-danger">Error loading safety events: ${err.message}</p>`;
  }
}

function bindAeForm() {
  const form = document.getElementById('aeForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const severity = document.getElementById('aeSeverity').value;
    const herb = document.getElementById('aeHerb').value;
    const patientId = document.getElementById('aePatientId').value;

    const payload = {
      patient_id: patientId,
      trial_id: document.getElementById('aeTrialId').value,
      severity,
      suspected_herb: herb,
      symptom_description: document.getElementById('aeSymptom').value
    };

    try {
      const res = await apiFetch('/api/pharmacovigilance', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        alert(`Failed to submit AE: ${await readError(res, 'Server Error')}`);
        return;
      }

      if (isSerious(severity)) {
        showAlertBanner(`⚠️ CRITICAL SAE: Severe reaction to ${herb} reported for patient #${patientId}!`, 'danger');
      }

      alert('Adverse Event reported successfully.');
      form.reset();
      loadAEModule();
    } catch (err) {
      alert(`Network Error: ${err.message}`);
    }
  });
}
