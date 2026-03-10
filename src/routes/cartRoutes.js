const router = require('express').Router();
const { getCart, addToCart, updateCartItem, removeFromCart } = require('../controllers/cartController');
const { authenticate } = require('../middleware/auth');

// All cart routes require authentication
router.use(authenticate);

// GET  /api/cart
router.get('/', getCart);

// POST /api/cart
router.post('/', addToCart);

// PUT  /api/cart/:product_id
router.put('/:product_id', updateCartItem);

// DELETE /api/cart/:product_id
router.delete('/:product_id', removeFromCart);

module.exports = router;
