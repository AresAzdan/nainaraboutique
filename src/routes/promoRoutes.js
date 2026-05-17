const router = require('express').Router();
const {
  getAllPromoCodes,
  createPromoCode,
  updatePromoCode,
  deletePromoCode,
  validatePromoCode,
} = require('../controllers/promoController');
const { authenticate, authorizeAdmin } = require('../middleware/auth');

// Admin routes
router.get('/admin/promo-codes', authenticate, authorizeAdmin, getAllPromoCodes);
router.post('/admin/promo-codes', authenticate, authorizeAdmin, createPromoCode);
router.put('/admin/promo-codes/:id', authenticate, authorizeAdmin, updatePromoCode);   // ← was missing
router.delete('/admin/promo-codes/:id', authenticate, authorizeAdmin, deletePromoCode);

// Customer route — requires login
router.post('/promo-codes/validate', authenticate, validatePromoCode);

module.exports = router;
