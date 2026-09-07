const crypto = require('crypto');

// Produces a byte-identical string at sign time and at verify time.
// Any change here invalidates every signature already stored in the database.
function generateCanonicalHashPayload(record, signerId) {
  const doshaData = typeof record.dosha_data === 'string'
    ? JSON.parse(record.dosha_data)
    : (record.dosha_data || {});

  const normalizedObject = {
    id: Number(record.id),
    patient_id: Number(record.patient_id),
    visit_number: Number(record.visit_number),
    dosha_data: doshaData,
    anupana_details: record.anupana_details || ''
  };

  return JSON.stringify(normalizedObject) + Number(signerId);
}

function computeEcrfHash(record, signerId) {
  const payloadString = generateCanonicalHashPayload(record, signerId);
  return crypto.createHash('sha256').update(payloadString).digest('hex');
}

module.exports = { generateCanonicalHashPayload, computeEcrfHash };
