const router   = require('express').Router();
const { register, login, getMe, updateProfile, changePassword, forgotPassword, resetPassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const UserModel = require('../models/userModel');
const { createError } = require('../middleware/errorHandler');

// POST /api/auth/register
router.post('/register', validate(['name', 'email', 'password']), register);

// POST /api/auth/login
router.post('/login', validate(['email', 'password']), login);

// GET /api/auth/me  — protected
router.get('/me', authenticate, getMe);

// PUT /api/auth/profile — update name & phone
router.put('/profile', authenticate, updateProfile);

// PUT /api/auth/password — change password
router.put('/password', authenticate, changePassword);

// POST /api/auth/forgot-password — request reset token
router.post('/forgot-password', forgotPassword);

// POST /api/auth/reset-password — use token to reset
router.post('/reset-password', resetPassword);

// ── ADDRESS ENDPOINTS ─────────────────────────────────────────────

// GET /api/auth/addresses — list saved addresses
router.get('/addresses', authenticate, async (req, res, next) => {
  try {
    const addresses = await UserModel.getAddresses(req.user.id);
    res.json(addresses);
  } catch (err) { next(err); }
});

// POST /api/auth/addresses — save a new address
router.post('/addresses', authenticate, async (req, res, next) => {
  try {
    const {
      label, recipient_name, phone, address,
      province_id, province_name,
      city_id, city_name,
      district_id, district_name,
      postal_code, is_default,
    } = req.body;

    if (!recipient_name) throw createError(400, 'Recipient name is required.');
    if (!address)        throw createError(400, 'Address is required.');

    // Limit to 5 saved addresses per user
    const existing = await UserModel.getAddresses(req.user.id);
    if (existing.length >= 5) throw createError(400, 'Maximum 5 saved addresses allowed.');

    const saved = await UserModel.createAddress(req.user.id, {
      label, recipient_name, phone, address,
      province_id, province_name, city_id, city_name,
      district_id, district_name, postal_code, is_default,
    });
    res.status(201).json({ message: 'Address saved.', address: saved });
  } catch (err) { next(err); }
});

// DELETE /api/auth/addresses/:id — delete a saved address
router.delete('/addresses/:id', authenticate, async (req, res, next) => {
  try {
    const deleted = await UserModel.deleteAddress(req.params.id, req.user.id);
    if (!deleted) throw createError(404, 'Address not found.');
    res.json({ message: 'Address deleted.' });
  } catch (err) { next(err); }
});

// PATCH /api/auth/addresses/:id/default — set as default address
router.patch('/addresses/:id/default', authenticate, async (req, res, next) => {
  try {
    const addr = await UserModel.setDefaultAddress(req.params.id, req.user.id);
    if (!addr) throw createError(404, 'Address not found.');
    res.json({ message: 'Default address updated.', address: addr });
  } catch (err) { next(err); }
});

module.exports = router;
