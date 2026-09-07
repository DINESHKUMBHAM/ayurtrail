/* ==========================================================================
   Bootstrap. Loaded last -- every other module is already parsed by now.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  bindSession();
  bindTrialForm();
  bindPatientForm();
  bindEcrfForm();
  bindAeForm();

  const alertClose = document.getElementById('systemAlertClose');
  if (alertClose) alertClose.addEventListener('click', hideAlertBanner);

  renderScreenState();
});
