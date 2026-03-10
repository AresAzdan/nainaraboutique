const db = require('../config/db');

const ReviewModel = {
  async findByProduct(productId) {
    const { rows } = await db.query(
      `SELECT r.*, u.name AS user_name
       FROM product_reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.product_id = $1
       ORDER BY r.created_at DESC`,
      [productId]
    );
    return rows;
  },

  async findByUser(userId) {
    const { rows } = await db.query(
      `SELECT r.*, p.name AS product_name, p.image_url
       FROM product_reviews r
       JOIN products p ON r.product_id = p.id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    return rows;
  },

  async create({ productId, userId, orderId, rating, reviewText }) {
    const { rows } = await db.query(
      `INSERT INTO product_reviews (product_id, user_id, order_id, rating, review_text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [productId, userId, orderId || null, rating, reviewText || '']
    );
    return rows[0];
  },

  async getAverageRating(productId) {
    const { rows } = await db.query(
      `SELECT COALESCE(AVG(rating), 0) AS avg_rating, COUNT(*) AS review_count
       FROM product_reviews WHERE product_id = $1`,
      [productId]
    );
    return { avg_rating: parseFloat(rows[0].avg_rating).toFixed(1), review_count: parseInt(rows[0].review_count) };
  },

  async hasReviewed(productId, userId, orderId) {
    const { rows } = await db.query(
      `SELECT id FROM product_reviews WHERE product_id = $1 AND user_id = $2 AND order_id = $3`,
      [productId, userId, orderId]
    );
    return rows.length > 0;
  },
};

module.exports = ReviewModel;
