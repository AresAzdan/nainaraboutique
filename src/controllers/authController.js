const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');
const UserModel   = require('../models/userModel');
const { createError } = require('../middleware/errorHandler');

const SALT_ROUNDS = 10;

const signToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const existing = await UserModel.findByEmail(email);
    if (existing) throw createError(409, 'Email already in use.');
    if (password.length < 6) throw createError(400, 'Password must be at least 6 characters.');
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await UserModel.create({ name, email, hashedPassword });
    const token = signToken(user);
    res.status(201).json({ message: 'Registration successful.', token, user });
  } catch (err) { next(err); }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    // Explicitly cast to string — bcrypt.compare(null/undefined, hash)
    // returns false silently, causing a confusing 401 with no real error.
    const email    = typeof req.body.email    === 'string' ? req.body.email.trim() : null;
    const password = typeof req.body.password === 'string' ? req.body.password     : null;
    // NOTE: Never trim() password — spaces may be intentional.

    if (!email || !password) {
      return next(createError(400, 'Email and password are required.'));
    }

    const user = await UserModel.findByEmail(email);
    if (!user) throw createError(401, 'Invalid email or password.');

    // Guard: stored hash must be a non-empty string.
    // If null (e.g. OAuth-only account), bcrypt.compare would silently return false.
    if (!user.password || typeof user.password !== 'string') {
      throw createError(401, 'Invalid email or password.');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw createError(401, 'Invalid email or password.');

    const token = signToken(user);
    res.json({
      message: 'Login successful.',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) { next(err); }
};

// GET /api/auth/me
const getMe = async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.user.id);
    if (!user) throw createError(404, 'User not found.');
    res.json(user);
  } catch (err) { next(err); }
};

// PUT /api/auth/profile
const updateProfile = async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    if (!name || name.trim().length === 0) throw createError(400, 'Name is required.');
    const user = await UserModel.updateProfile(req.user.id, { name: name.trim(), phone: phone?.trim() || null });
    if (!user) throw createError(404, 'User not found.');
    res.json({ message: 'Profile updated.', user });
  } catch (err) { next(err); }
};

// PUT /api/auth/password
const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) throw createError(400, 'Both current and new password are required.');
    if (new_password.length < 6) throw createError(400, 'New password must be at least 6 characters.');
    const user = await UserModel.findByIdWithPassword(req.user.id);
    if (!user) throw createError(404, 'User not found.');
    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) throw createError(401, 'Current password is incorrect.');
    const hashed = await bcrypt.hash(new_password, SALT_ROUNDS);
    await UserModel.updatePassword(req.user.id, hashed);
    res.json({ message: 'Password changed successfully.' });
  } catch (err) { next(err); }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) throw createError(400, 'Email is required.');
    const user = await UserModel.findByEmail(email);
    if (!user) return res.json({ message: 'If that email exists, a reset link has been generated.' });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.query('INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, token, expiresAt]);
    res.json({
      message: 'If that email exists, a reset link has been generated.',
      reset_token: token,
      reset_url: `http://127.0.0.1:5500/nainararevvv_ada_user.html#reset-password?token=${token}`
    });
  } catch (err) { next(err); }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res, next) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) throw createError(400, 'Token and new password are required.');
    if (new_password.length < 6) throw createError(400, 'Password must be at least 6 characters.');
    const { rows } = await db.query('SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()', [token]);
    if (!rows[0]) throw createError(400, 'Invalid or expired reset token.');
    const hashed = await bcrypt.hash(new_password, SALT_ROUNDS);
    await UserModel.updatePassword(rows[0].user_id, hashed);
    await db.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [rows[0].id]);
    res.json({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) { next(err); }
};

module.exports = { register, login, getMe, updateProfile, changePassword, forgotPassword, resetPassword };
