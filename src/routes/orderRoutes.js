const router = require('express').Router();
const {
  createOrder,
  createGuestOrder,
  getMyOrders,
  getMyOrder,
  updateOrderStatus,
  cancelOrder,
  requestRefund,
  getGuestOrder,
} = require('../controllers/orderController');
const { handleNotification } = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

// ── Public routes (NO authentication required) ────────────────────────────────

// Midtrans webhook — must be public, Midtrans calls this server-to-server
router.post('/midtrans/notification', handleNotification);

// Guest checkout — create order without auth
router.post('/guest', createGuestOrder);

// Guest order lookup — declared BEFORE router.use(authenticate) so it stays public
router.get('/guest/:id', getGuestOrder);

// ── Authenticated routes ───────────────────────────────────────────────────────
router.use(authenticate);

// Place order from cart
router.post('/', createOrder);

// List all orders for the logged-in user
router.get('/', getMyOrders);

// Update order status (user marks as paid for manual transfer, etc.)
router.patch('/:id/status', updateOrderStatus);

// Cancel a pending order
router.patch('/:id/cancel', cancelOrder);

// Request refund for a paid order. This does not call Midtrans.
router.post('/:id/refund-request', requestRefund);

// Get single order detail (own only) — keep LAST among /:id patterns
router.get('/:id', getMyOrder);

module.exports = router;
