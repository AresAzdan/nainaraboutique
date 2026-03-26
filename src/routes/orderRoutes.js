const router = require('express').Router();
const {
  createOrder,
  createGuestOrder,
  getMyOrders,
  getMyOrder,
  updateOrderStatus,
  cancelOrder,
  midtransNotification,
  getGuestOrder,
} = require('../controllers/orderController');
const { authenticate } = require('../middleware/auth');

// ── Public routes (NO authentication required) ────────────────────────────────

// Midtrans webhook
router.post('/midtrans/notification', midtransNotification);

// Guest checkout — create order
router.post('/guest', createGuestOrder);

// Guest order lookup — MUST be declared before router.use(authenticate)
// FIX: This route was already above authenticate in the original file, which
// is correct. Keeping it explicit here to make the intent clear and ensure
// no future refactor accidentally moves it below the auth wall.
router.get('/guest/:id', getGuestOrder);

// ── Authenticated routes ───────────────────────────────────────────────────────
router.use(authenticate);

// Place order from cart
router.post('/', createOrder);

// List all my orders
router.get('/', getMyOrders);

// Update order status (user marks as paid)
router.patch('/:id/status', updateOrderStatus);

// Cancel a pending order
router.patch('/:id/cancel', cancelOrder);

// Get single order (own only) — must be LAST among /:id patterns
router.get('/:id', getMyOrder);

module.exports = router;
