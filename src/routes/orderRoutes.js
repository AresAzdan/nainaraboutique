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

// POST /api/orders/guest  — public, no login required
router.post('/guest', createGuestOrder);

router.post('/midtrans/notification', midtransNotification);

router.get('/guest/:id', getGuestOrder);

router.use(authenticate);

// POST /api/orders  — place order from cart
router.post('/', createOrder);

// GET /api/orders  — all my orders
router.get('/', getMyOrders);

router.patch('/:id/status', updateOrderStatus);

// PATCH /api/orders/:id/cancel  — cancel a pending order
router.patch('/:id/cancel', cancelOrder);

// GET /api/orders/:id  — single order (own only)
router.get('/:id', getMyOrder);

module.exports = router;
