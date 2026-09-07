const db = require('../db/pool');

/*
 * Trial analytics metrics.
 *
 * Every metric is computed from data actually in the database. Where the data
 * needed for a metric is absent (no enrolment history yet, no recruitment
 * target set), the metric reports status 'unavailable' with the reason rather
 * than returning a fabricated number -- these figures describe a clinical
 * trial, so a plausible-looking guess is worse than an honest blank.
 *
 * Each metric is computed independently and its own failure is contained, so
 * one missing table degrades a single card instead of the whole dashboard.
 */

const SERIOUS_SEVERITIES = ['SAE', 'SEVERE', 'CRITICAL'];
const ACTIVE_TRIAL_STATUSES = ['ACTIVE', 'OPEN'];

// Trailing windows, in days.
const SAFETY_WINDOW_DAYS = 30;
const VELOCITY_WINDOW_DAYS = 28;

// Deviation severity weights, used for both the deviation risk metric and as
// an input to the composite risk score.
const DEVIATION_WEIGHTS = { CRITICAL: 5, MAJOR: 3, MINOR: 1 };

const unavailable = (label, reason) => ({
  label,
  display: '--',
  value: null,
  status: 'unavailable',
  detail: reason
});

// Runs one metric, converting any failure into an 'unavailable' card.
async function safely(label, fn) {
  try {
    return await fn();
  } catch (err) {
    return unavailable(label, `Not computable: ${err.message}`);
  }
}

async function activeProtocols() {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS count FROM trials WHERE UPPER(TRIM(status)) IN (?)`,
    [ACTIVE_TRIAL_STATUSES]
  );
  return {
    label: 'Active Protocols',
    display: String(row.count),
    value: row.count,
    status: 'neutral',
    detail: 'Trials with status ACTIVE or OPEN'
  };
}

async function totalEnrolledSubjects() {
  const [[row]] = await db.query(`SELECT COUNT(*) AS count FROM patients`);
  return {
    label: 'Total Enrolled Subjects',
    display: String(row.count),
    value: row.count,
    status: 'neutral',
    detail: 'All registered participants across every trial'
  };
}

// CLEAR / MONITOR / SIGNAL based on serious events in the trailing window.
async function safetySignalStatus() {
  const [[row]] = await db.query(
    `SELECT
       SUM(CASE WHEN UPPER(TRIM(severity)) IN (?) THEN 1 ELSE 0 END) AS serious,
       COUNT(*) AS total
     FROM adverse_events
     WHERE reported_at >= NOW() - INTERVAL ? DAY`,
    [SERIOUS_SEVERITIES, SAFETY_WINDOW_DAYS]
  );

  const serious = Number(row.serious || 0);
  const total = Number(row.total || 0);

  let display = 'CLEAR';
  let status = 'good';
  if (serious >= 3) {
    display = 'SIGNAL';
    status = 'danger';
  } else if (serious >= 1) {
    display = 'MONITOR';
    status = 'warn';
  }

  return {
    label: 'Safety Signal Status',
    display,
    value: serious,
    status,
    detail: `${serious} serious of ${total} events in the last ${SAFETY_WINDOW_DAYS} days`
  };
}

// Subjects enrolled per week, averaged over the trailing window.
async function recruitmentVelocity() {
  const [[row]] = await db.query(
    `SELECT
       COUNT(enrolled_at) AS dated,
       SUM(CASE WHEN enrolled_at >= NOW() - INTERVAL ? DAY THEN 1 ELSE 0 END) AS recent
     FROM patients`,
    [VELOCITY_WINDOW_DAYS]
  );

  if (Number(row.dated || 0) === 0) {
    return unavailable(
      'Recruitment Velocity',
      'No enrolment dates recorded yet. Newly registered subjects will populate this.'
    );
  }

  const perWeek = (Number(row.recent || 0) * 7) / VELOCITY_WINDOW_DAYS;

  return {
    label: 'Recruitment Velocity',
    display: `${perWeek.toFixed(1)}/wk`,
    value: perWeek,
    status: perWeek > 0 ? 'good' : 'warn',
    detail: `${row.recent} enrolled in the last ${VELOCITY_WINDOW_DAYS} days`
  };
}

// Observed retention: the share of subjects who have not withdrawn.
// This is a measured rate, not a predictive model.
async function patientRetention() {
  const [[row]] = await db.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN UPPER(TRIM(status)) = 'WITHDRAWN' THEN 1 ELSE 0 END) AS withdrawn
     FROM patients`
  );

  const total = Number(row.total || 0);
  if (total === 0) {
    return unavailable('Patient Retention', 'No subjects enrolled yet.');
  }

  const withdrawn = Number(row.withdrawn || 0);
  const rate = ((total - withdrawn) / total) * 100;

  return {
    label: 'Patient Retention',
    display: `${rate.toFixed(1)}%`,
    value: rate,
    status: rate >= 90 ? 'good' : rate >= 75 ? 'warn' : 'danger',
    detail: `${withdrawn} withdrawn of ${total} enrolled (observed rate, not a forecast)`
  };
}

// Weighted count of unresolved protocol deviations.
async function protocolDeviationRisk() {
  const [[row]] = await db.query(
    `SELECT
       SUM(CASE WHEN UPPER(TRIM(severity)) = 'CRITICAL' THEN 1 ELSE 0 END) AS critical,
       SUM(CASE WHEN UPPER(TRIM(severity)) = 'MAJOR' THEN 1 ELSE 0 END) AS major,
       SUM(CASE WHEN UPPER(TRIM(severity)) = 'MINOR' THEN 1 ELSE 0 END) AS minor
     FROM queries_deviations
     WHERE category = 'PROTOCOL_DEVIATION' AND UPPER(TRIM(status)) <> 'RESOLVED'`
  );

  const critical = Number(row.critical || 0);
  const major = Number(row.major || 0);
  const minor = Number(row.minor || 0);

  const score =
    critical * DEVIATION_WEIGHTS.CRITICAL +
    major * DEVIATION_WEIGHTS.MAJOR +
    minor * DEVIATION_WEIGHTS.MINOR;

  let display = 'LOW';
  let status = 'good';
  if (score >= 10) {
    display = 'HIGH';
    status = 'danger';
  } else if (score >= 4) {
    display = 'MEDIUM';
    status = 'warn';
  }

  return {
    label: 'Protocol Deviation Risk',
    display,
    value: score,
    status,
    detail: `${critical} critical, ${major} major, ${minor} minor open (weighted score ${score})`,
    inputs: { critical, major, minor, score }
  };
}

// Projects a completion date from remaining places and current velocity.
async function estimatedTrialCompletion(velocityMetric) {
  const [[row]] = await db.query(
    `SELECT
       SUM(t.target_enrollment) AS target,
       COUNT(p.id) AS enrolled
     FROM trials t
     LEFT JOIN patients p ON p.trial_id = t.id
     WHERE UPPER(TRIM(t.status)) IN (?) AND t.target_enrollment IS NOT NULL`,
    [ACTIVE_TRIAL_STATUSES]
  );

  const target = Number(row.target || 0);
  if (target === 0) {
    return unavailable(
      'Est. Trial Completion',
      'No recruitment target set on any active trial.'
    );
  }

  if (!velocityMetric || velocityMetric.status === 'unavailable' || !(velocityMetric.value > 0)) {
    return unavailable(
      'Est. Trial Completion',
      'Needs a positive recruitment velocity to project a date.'
    );
  }

  const enrolled = Number(row.enrolled || 0);
  const remaining = Math.max(0, target - enrolled);

  if (remaining === 0) {
    return {
      label: 'Est. Trial Completion',
      display: 'Target met',
      value: 0,
      status: 'good',
      detail: `${enrolled} of ${target} places filled`
    };
  }

  const weeks = remaining / velocityMetric.value;
  const projected = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000);

  return {
    label: 'Est. Trial Completion',
    display: projected.toISOString().slice(0, 10),
    value: projected.toISOString(),
    status: weeks > 52 ? 'warn' : 'good',
    detail: `${remaining} places left at ${velocityMetric.value.toFixed(1)}/wk (~${Math.ceil(weeks)} weeks)`
  };
}

/*
 * Composite risk score, 0-100 (higher is worse).
 *
 * This is a transparent weighted heuristic over four measured signals, NOT a
 * trained model and NOT a statistical prediction. It is labelled as such in
 * the UI, and `inputs` exposes every contributing term so the number can
 * always be traced back to the rows that produced it.
 */
const RISK_WEIGHTS = { safety: 40, deviations: 25, signatures: 15, recruitment: 20 };

async function compositeRiskScore(deviationMetric, velocityMetric) {
  const [[safety]] = await db.query(
    `SELECT
       SUM(CASE WHEN UPPER(TRIM(severity)) IN (?) THEN 1 ELSE 0 END) AS serious
     FROM adverse_events
     WHERE reported_at >= NOW() - INTERVAL ? DAY`,
    [SERIOUS_SEVERITIES, SAFETY_WINDOW_DAYS]
  );

  const [[signatures]] = await db.query(
    `SELECT COUNT(*) AS pending
     FROM ecrf_entries e
     LEFT JOIN ecrf_signatures s ON e.id = s.ecrf_id
     WHERE s.id IS NULL`
  );

  // Each term is normalised to 0..1, then weighted.
  const seriousCount = Number(safety.serious || 0);
  const pendingCount = Number(signatures.pending || 0);
  const deviationScore = deviationMetric && deviationMetric.value != null ? deviationMetric.value : 0;

  const safetyTerm = Math.min(1, seriousCount / 5);
  const deviationTerm = Math.min(1, deviationScore / 15);
  const signatureTerm = Math.min(1, pendingCount / 20);
  // A stalled recruitment pipeline is itself a risk; unknown velocity is
  // treated as neutral (0.5) rather than as either good or bad news.
  const recruitmentTerm = !velocityMetric || velocityMetric.status === 'unavailable'
    ? 0.5
    : (velocityMetric.value > 0 ? 0 : 1);

  const score = Math.round(
    safetyTerm * RISK_WEIGHTS.safety +
    deviationTerm * RISK_WEIGHTS.deviations +
    signatureTerm * RISK_WEIGHTS.signatures +
    recruitmentTerm * RISK_WEIGHTS.recruitment
  );

  return {
    label: 'Composite Risk Score',
    display: `${score}/100`,
    value: score,
    status: score >= 60 ? 'danger' : score >= 30 ? 'warn' : 'good',
    detail: 'Weighted heuristic over safety, deviations, unsigned eCRFs and recruitment. Not a trained model.',
    inputs: {
      serious_aes_30d: seriousCount,
      open_deviation_score: deviationScore,
      unsigned_ecrfs: pendingCount,
      recruitment_stalled: recruitmentTerm === 1,
      weights: RISK_WEIGHTS
    }
  };
}

async function getTrialMetrics() {
  // Deviation risk and velocity feed the composite score and the completion
  // projection, so they are resolved first.
  const [deviation, velocity] = await Promise.all([
    safely('Protocol Deviation Risk', protocolDeviationRisk),
    safely('Recruitment Velocity', recruitmentVelocity)
  ]);

  const [protocols, enrolled, risk, safety, retention, completion] = await Promise.all([
    safely('Active Protocols', activeProtocols),
    safely('Total Enrolled Subjects', totalEnrolledSubjects),
    safely('Composite Risk Score', () => compositeRiskScore(deviation, velocity)),
    safely('Safety Signal Status', safetySignalStatus),
    safely('Patient Retention', patientRetention),
    safely('Est. Trial Completion', () => estimatedTrialCompletion(velocity))
  ]);

  // Order here is the display order on the dashboard.
  return {
    active_protocols: protocols,
    total_enrolled_subjects: enrolled,
    composite_risk_score: risk,
    safety_signal_status: safety,
    recruitment_velocity: velocity,
    patient_retention: retention,
    protocol_deviation_risk: deviation,
    estimated_trial_completion: completion
  };
}

module.exports = { getTrialMetrics };
