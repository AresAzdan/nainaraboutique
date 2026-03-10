const ReviewModel = require('../models/reviewModel');
const { createError } = require('../middleware/errorHandler');
const db = require('../config/db');

// GET /api/products/:id/reviews — public
const getProductReviews = async (req, res, next) => {
  try {
    const reviews = await ReviewModel.findByProduct(req.params.id);
    const stats = await ReviewModel.getAverageRating(req.params.id);
    res.json({ reviews, ...stats });
  } catch (err) { next(err); }
};

// POST /api/products/:id/reviews — authenticated
const createReview = async (req, res, next) => {
  try {
    const { rating, review_text, order_id } = req.body;
    const productId = parseInt(req.params.id);
    const userId = req.user.id;

    if (!rating || rating < 1 || rating > 5) throw createError(400, 'Rating must be between 1 and 5.');

    // Check if user purchased this product
    const { rows: orderCheck } = await db.query(
      `SELECT o.id FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.user_id = $1 AND oi.product_id = $2 AND o.status = 'completed'
       LIMIT 1`,
      [userId, productId]
    );
    if (!orderCheck.length) throw createError(403, 'You can only review products you have purchased.');

    // Check if already reviewed for this order
    if (order_id) {
      const exists = await ReviewModel.hasReviewed(productId, userId, order_id);
      if (exists) throw createError(409, 'You have already reviewed this product for this order.');
    }

    const review = await ReviewModel.create({
      productId, userId, orderId: order_id || orderCheck[0].id, rating, reviewText: review_text || ''
    });

    res.status(201).json({ message: 'Review submitted.', review });
  } catch (err) { next(err); }
};

// GET /api/reviews/mine — authenticated, user's own reviews
const getMyReviews = async (req, res, next) => {
  try {
    const reviews = await ReviewModel.findByUser(req.user.id);
    res.json(reviews);
  } catch (err) { next(err); }
};

module.exports = { getProductReviews, createReview, getMyReviews };
