const router = require('express').Router();
const { getProductReviews, createReview, getMyReviews } = require('../controllers/reviewController');
const { authenticate } = require('../middleware/auth');

// GET /api/products/:id/reviews — public
router.get('/products/:id/reviews', getProductReviews);

// POST /api/products/:id/reviews — authenticated
router.post('/products/:id/reviews', authenticate, createReview);

// GET /api/reviews/mine — authenticated
router.get('/reviews/mine', authenticate, getMyReviews);

module.exports = router;
