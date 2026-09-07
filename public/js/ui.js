/* ==========================================================================
   Section router and the system alert banner.
   ========================================================================== */

// Which loader runs when a section becomes visible.
const SECTION_LOADERS = {
  dashboard: () => {
    // Chart.js needs the canvas to have been laid out, which only happens once
    // the section has `active`. Wait for a frame plus a beat before drawing.
    requestAnimationFrame(() => setTimeout(loadDashboard, 60));
  },
  patients: () => {
    applyTrialFormVisibility();
    loadPatientModule();
    loadRandomizationModule();
  },
  ecrf: () => loadEcrfTable(),
  pharmacovigilance: () => loadAEModule(),
  audit: () => fetchAuditLogs()
};

function navigate(sectionId) {
  document.querySelectorAll('.page-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.sidebar nav button').forEach(btn => btn.classList.remove('active-nav'));

  const targetSection = document.getElementById(sectionId);
  const targetNav = document.getElementById(`nav-${sectionId}`);

  if (targetSection) targetSection.classList.add('active');
  if (targetNav) targetNav.classList.add('active-nav');

  const load = SECTION_LOADERS[sectionId];
  if (load) load();
}

function showAlertBanner(message, type = 'danger') {
  const banner = document.getElementById('systemAlertBanner');
  const text = document.getElementById('systemAlertText');
  if (!banner || !text) return;

  text.innerText = message;
  banner.style.backgroundColor = type === 'danger' ? 'var(--danger)' : 'var(--warning)';
  banner.classList.add('visible');
}

function hideAlertBanner() {
  const banner = document.getElementById('systemAlertBanner');
  if (banner) banner.classList.remove('visible');
}

// Replaces a table body with a single full-width message row.
function renderTableMessage(tbody, colspan, message, isError = false) {
  tbody.innerHTML = `<tr><td colspan="${colspan}" class="cell-message${isError ? ' is-error' : ''}">${message}</td></tr>`;
}
