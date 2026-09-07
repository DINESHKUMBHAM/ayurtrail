// Throws on anything that is not a positive integer. Callers catch and map the
// error to a 400/500 depending on the route.
function validateId(id, name = 'ID') {
  const parsed = parseInt(id, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: Must be a positive integer.`);
  }
  return parsed;
}

module.exports = validateId;
