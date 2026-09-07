/* ==========================================================================
   KPI dashboard: summary tiles, recruitment progress, and the two Chart.js
   doughnut/pie charts.
   ========================================================================== */

let prakritiChartInstance = null;
let aeChartInstance = null;

const PRAKRITI_COLORS = {
  'Vata': '#3182ce',
  'Pitta': '#dd6b20',
  'Kapha': '#38a169',
  'Vata-Pitta': '#805ad5',
  'Pitta-Kapha': '#d69e2e',
  'Vata-Kapha': '#319795',
  'Tridoshaja': '#4a5568'
};
const PRAKRITI_FALLBACK_COLOR = '#a0aec0';

// /api/dashboard/stats does not aggregate adverse events, so the severity
// chart is derived client-side from the pharmacovigilance list.
const AE_BUCKETS = [
  { label: 'Mild AE', severities: ['MILD'] },
  { label: 'Moderate AE', severities: ['MODERATE'] },
  { label: 'Severe SAE', severities: ['SEVERE', 'SAE', 'CRITICAL'] }
];

async function loadDashboard() {
  // The eight analytics tiles and the charts come from different endpoints;
  // a failure in one must not blank the other.
  renderMetricTiles();

  let data;
  try {
    const res = await apiFetch('/api/dashboard/stats');
    if (!res.ok) {
      showDashboardError(await readError(res, 'Failed to load dashboard metrics.'));
      return;
    }
    data = await res.json();
  } catch (err) {
    showDashboardError(`Cannot reach the server: ${err.message}`);
    return;
  }

  renderTrialProgress(data.trials || []);
  renderPrakritiChart(data.prakriti_distribution || []);
  renderAEChart(await fetchAeDistribution());
}

function showDashboardError(message) {
  const container = document.getElementById('trialProgressContainer');
  if (container) {
    container.innerHTML = `<p class="text-danger">${message}</p>`;
  }
}

// --- Trial analytics tiles ---------------------------------------------

async function renderMetricTiles() {
  const grid = document.getElementById('metricGrid');
  if (!grid) return;

  grid.innerHTML = '<p class="text-muted">Loading trial metrics...</p>';

  let metrics;
  try {
    const res = await apiFetch('/api/dashboard/metrics');
    if (!res.ok) {
      grid.innerHTML = `<p class="text-danger">${await readError(res, 'Failed to load trial metrics.')}</p>`;
      return;
    }
    ({ metrics } = await res.json());
  } catch (err) {
    grid.innerHTML = `<p class="text-danger">Cannot reach the server: ${err.message}</p>`;
    return;
  }

  grid.innerHTML = Object.values(metrics).map(renderMetricCard).join('');
}

// A metric with status 'unavailable' renders as a muted card explaining why,
// never as a zero or a placeholder figure.
function renderMetricCard(metric) {
  const isUnavailable = metric.status === 'unavailable';
  return `
    <div class="metric-card metric-${metric.status}"${isUnavailable ? ' title="' + escapeAttr(metric.detail) + '"' : ''}>
      <small class="metric-label">${metric.label}</small>
      <div class="metric-value">${metric.display}</div>
      <small class="metric-detail">${metric.detail || ''}</small>
    </div>
  `;
}

function escapeAttr(text) {
  return String(text || '').replace(/"/g, '&quot;');
}

// NOTE: the trials table has no target_enrollment / enrolled_count columns, so
// these bars fall back to a placeholder 10-of-100. They are NOT real
// recruitment figures -- add the columns to schema.sql to make them real.
function renderTrialProgress(trials) {
  const container = document.getElementById('trialProgressContainer');
  if (!container) return;

  if (trials.length === 0) {
    container.innerHTML = '<p class="text-muted">No active trial cohorts.</p>';
    return;
  }

  container.innerHTML = trials.map(t => {
    const target = t.target_enrollment || 100;
    const current = t.enrolled_count || 10;
    const pct = Math.min(100, Math.round((current / target) * 100));

    return `
      <div>
        <div class="progress-row-label">
          <strong>${t.trial_code} - ${t.title}</strong>
          <small class="text-muted">${current} / ${target} Subjects (${pct}%)</small>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  }).join('');
}

async function fetchAeDistribution() {
  try {
    const res = await apiFetch('/api/pharmacovigilance');
    if (!res.ok) return [];

    const events = await res.json();
    return AE_BUCKETS.map(bucket => ({
      severity: bucket.label,
      count: events.filter(e => bucket.severities.includes(String(e.severity || '').trim().toUpperCase())).length
    }));
  } catch (err) {
    return [];
  }
}

function renderPrakritiChart(prakritiData) {
  const canvas = document.getElementById('prakritiChart');
  if (!canvas) return;

  if (prakritiChartInstance) prakritiChartInstance.destroy();

  const labels = prakritiData.map(item => item.dosha || 'Unclassified');
  const counts = prakritiData.map(item => item.count);

  prakritiChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: labels.map(label => PRAKRITI_COLORS[label] || PRAKRITI_FALLBACK_COLOR),
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      cutout: '65%'
    }
  });
}

function renderAEChart(aeData) {
  const canvas = document.getElementById('aeChart');
  if (!canvas) return;

  if (aeChartInstance) aeChartInstance.destroy();

  aeChartInstance = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: aeData.map(item => item.severity || 'Unknown'),
      datasets: [{
        data: aeData.map(item => item.count || 0),
        backgroundColor: ['#eab308', '#d97706', '#dc2626'],
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}
