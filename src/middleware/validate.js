/**
 * Lightweight field validator.
 * Pass an array of required field names; returns 400 if any are missing/empty.
 * Catches: undefined, null, empty string, whitespace-only, and non-string types
 * that would silently break downstream operations like bcrypt.compare().
 *
 * Usage: router.post('/route', validate(['email','password']), controller)
 */
const validate = (fields) => (req, res, next) => {
  // Guard: if body wasn't parsed at all (missing express.json()), fail clearly
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      message: 'Request body is missing or not valid JSON. Ensure Content-Type: application/json.',
    });
  }

  const missing = fields.filter((field) => {
    const value = req.body[field];
    // Catches: undefined, null, '', '   ' (whitespace-only)
    if (value === undefined || value === null) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
  });

  if (missing.length > 0) {
    return res.status(400).json({
      message: `Missing required fields: ${missing.join(', ')}`,
    });
  }

  next();
};

module.exports = validate;
