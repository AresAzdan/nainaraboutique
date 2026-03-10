/**
 * Lightweight field validator.
 * Pass an array of required field names; returns 400 if any are missing/empty.
 *
 * Usage: router.post('/route', validate(['email','password']), controller)
 */
const validate = (fields) => (req, res, next) => {
  const missing = fields.filter(
    (field) => req.body[field] === undefined || req.body[field] === ''
  );

  if (missing.length > 0) {
    return res.status(400).json({
      message: `Missing required fields: ${missing.join(', ')}`,
    });
  }
  next();
};

module.exports = validate;
