const router = require('express').Router();
const {
  getAllPromoCodes,
  createPromoCode,
  updatePromoCode,
  deletePromoCode,
  validatePromoCode,
} = require('../controllers/promoController');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Admin routes
router.get('/admin/promo-codes', authenticate, requireAdmin, getAllPromoCodes);
router.post('/admin/promo-codes', authenticate, requireAdmin, createPromoCode);
router.put('/admin/promo-codes/:id', authenticate, requireAdmin, updatePromoCode);   // ← was missing
router.delete('/admin/promo-codes/:id', authenticate, requireAdmin, deletePromoCode);

// Customer route — requires login
router.post('/promo-codes/validate', authenticate, validatePromoCode);

module.exports = router;
