const express = require('express');

const authRoutes = require('./auth.routes');
const trialsRoutes = require('./trials.routes');
const patientsRoutes = require('./patients.routes');
const randomizationRoutes = require('./randomization.routes');
const ecrfRoutes = require('./ecrf.routes');
const pharmacovigilanceRoutes = require('./pharmacovigilance.routes');
const auditRoutes = require('./audit.routes');
const exportRoutes = require('./export.routes');
const dashboardRoutes = require('./dashboard.routes');
const queriesRoutes = require('./queries.routes');
const organizationsRoutes = require('./organizations.routes');
const feedbackRoutes = require('./feedback.routes');

const router = express.Router();

// Randomization is mounted at the root because it owns paths under two
// prefixes: /api/patients/:id/randomize and /api/randomizations.
router.use('/', randomizationRoutes);

router.use('/', authRoutes);
router.use('/trials', trialsRoutes);
router.use('/patients', patientsRoutes);
router.use('/ecrf', ecrfRoutes);
router.use('/pharmacovigilance', pharmacovigilanceRoutes);
router.use('/audit', auditRoutes);
router.use('/export', exportRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/queries', queriesRoutes);
router.use('/organizations', organizationsRoutes);
router.use('/feedback', feedbackRoutes);

module.exports = router;
