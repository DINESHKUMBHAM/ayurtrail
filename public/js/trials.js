/* ==========================================================================
   Clinical trial registration, surfaced in the Patient Registry section.
   ========================================================================== */

// Only these roles may open a protocol; POST /api/trials enforces the same
// list server-side, this just avoids showing a form that would be rejected.
const TRIAL_CREATION_ROLES = ['PI', 'ADMIN'];

function canCreateTrials() {
  const user = getCurrentUser();
  return Boolean(user && TRIAL_CREATION_ROLES.includes(user.role));
}

// Hides the whole card for roles that cannot create trials.
function applyTrialFormVisibility() {
  const card = document.getElementById('trialFormCard');
  if (card) card.hidden = !canCreateTrials();
}

function bindTrialForm() {
  const form = document.getElementById('trialForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      trial_code: document.getElementById('trialCode').value,
      title: document.getElementById('trialTitle').value,
      phase: document.getElementById('trialPhase').value,
      status: document.getElementById('trialStatus').value,
      target_enrollment: document.getElementById('trialTarget').value,
      start_date: document.getElementById('trialStartDate').value
    };

    try {
      const res = await apiFetch('/api/trials', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        alert(`Failed to register trial: ${await readError(res)}`);
        return;
      }

      const data = await res.json();
      alert(`Clinical trial registered: ${data.trial_code}`);
      form.reset();

      // The new trial must appear in the participant dropdown immediately,
      // and it changes the active-protocol and completion metrics.
      await populateTrialSelect();
    } catch (err) {
      alert(`Network Error: ${err.message}`);
    }
  });
}
