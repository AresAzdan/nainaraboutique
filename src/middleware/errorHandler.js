/**
 * Global error handling middleware.
 * Catches any error passed via next(err) from controllers.
 */
const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path} →`, err.message);

  // PostgreSQL unique violation
  if (err.code === '23505') {
    return res.status(409).json({ message: 'A record with that value already exists.' });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ message: 'Related record not found.' });
  }

  // PostgreSQL check constraint violation
  if (err.code === '23514') {
    return res.status(400).json({ message: 'Value violates database constraint.' });
  }

  const status  = err.status  || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({ message });
};

/**
 * Creates a typed API error with an HTTP status code.
 * Usage: throw createError(404, 'Product not found')
 */
const createError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

module.exports = { errorHandler, createError };
