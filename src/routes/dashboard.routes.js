const express = require('express');

const db = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');
const { getTrialMetrics } = require('../services/trialMetrics');

const router = express.Router();

// GET /api/dashboard/metrics -- the eight trial analytics tiles.
// Each metric carries its own status and detail; metrics whose source data is
// missing come back as status 'unavailable' rather than a fabricated value.
router.get('/metrics', authenticateToken, async (req, res) => {
  try {
    res.json({ metrics: await getTrialMetrics() });
  } catch (err) {
    console.error('Trial Metrics Error:', err);
    res.status(500).json({ error: 'Failed to retrieve trial metrics.' });
  }
});

// GET /api/dashboard/stats -- all six aggregates run concurrently.
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const [
      [activeTrials],
      [totalPatients],
      [pendingSignatures],
      [activeSAE],
      [prakritiDist],
      [recentTrials]
    ] = await Promise.all([
      db.query(`SELECT COUNT(*) AS count FROM trials WHERE status = 'ACTIVE' OR status = 'OPEN'`),
      db.query(`SELECT COUNT(*) AS count FROM patients`),
      db.query(`
        SELECT COUNT(*) AS count
        FROM ecrf_entries e
        LEFT JOIN ecrf_signatures s ON e.id = s.ecrf_id
        WHERE s.id IS NULL
      `),
      db.query(`SELECT COUNT(*) AS count FROM adverse_events WHERE UPPER(TRIM(severity)) IN ('SAE', 'SEVERE', 'CRITICAL')`),
      db.query(`SELECT prakriti_baseline AS dosha, COUNT(*) AS count FROM patients GROUP BY prakriti_baseline`),
      db.query(`SELECT id, trial_code, title, phase, status FROM trials ORDER BY id DESC LIMIT 6`)
    ]);

    res.json({
      summary: {
        active_trials: activeTrials[0].count,
        total_patients: totalPatients[0].count,
        pending_signatures: pendingSignatures[0].count,
        active_sae: activeSAE[0].count
      },
      prakriti_distribution: prakritiDist,
      trials: recentTrials
    });
  } catch (err) {
    console.error('KPI Dashboard Error:', err);
    res.status(500).json({ error: 'Failed to retrieve dashboard metrics.' });
  }
});

module.exports = router;
