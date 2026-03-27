const router = require('express').Router();

const {
  createOrder,
  midtransNotification,
} = require('../controllers/orderController');

const { authenticate } = require('../middleware/auth');

// Midtrans webhook (public)
router.post('/midtrans/notification', midtransNotification);

// Auth routes
router.use(authenticate);

// Create order
router.post('/', createOrder);

module.exports = router;
