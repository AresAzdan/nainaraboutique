const db           = require('../config/db');
const ProductModel = require('../models/productModel');
const { createError } = require('../middleware/errorHandler');

// ─── GET /api/products ────────────────────────────────────────────────────────
const getProducts = async (req, res, next) => {
  try {
    const { category_id, search, page = 1, limit = 20 } = req.query;
    const products = await ProductModel.findAll({
      category_id: category_id ? Number(category_id) : undefined,
      search,
      page:  Number(page),
      limit: Number(limit),
    });
    res.json({ page: Number(page), limit: Number(limit), data: products });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/products/:id ────────────────────────────────────────────────────
const getProduct = async (req, res, next) => {
  try {
    const product = await ProductModel.findById(req.params.id);
    if (!product) throw createError(404, 'Product not found.');
    res.json(product);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/products/:id/reviews ───────────────────────────────────────────
// FIX: This endpoint was querying `product_reviews` directly with no try/catch
// (or the table simply didn't exist in production). Either way, Postgres throws
// error code 42P01 ("relation does not exist"), which went unhandled, caused an
// unhandledRejection, and crashed the Railway container → SIGTERM → 503.
//
// Fix strategy — OPTION 1 (safe degradation):
//   Catch error code 42P01 and return an empty array so the frontend renders
//   "No reviews yet" instead of crashing the server.
//   The SQL to create the table properly is provided in schema.sql.
const getProductReviews = async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id, 10);
    if (isNaN(productId)) throw createError(400, 'Invalid product id.');

    const result = await db.query(
      `SELECT
         r.id,
         r.product_id,
         r.user_id,
         u.name  AS user_name,
         r.rating,
         r.comment,
         r.created_at
       FROM product_reviews r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.product_id = $1
       ORDER BY r.created_at DESC`,
      [productId]
    );

    res.json(result.rows);
  } catch (err) {
    // 42P01 = undefined_table (product_reviews doesn't exist yet)
    if (err.code === '42P01') {
      console.warn('[getProductReviews] product_reviews table missing — returning empty array');
      return res.json([]);
    }
    next(err);
  }
};

// ─── POST /api/products/:id/reviews  (authenticated users) ───────────────────
const createProductReview = async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id, 10);
    if (isNaN(productId)) throw createError(400, 'Invalid product id.');

    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5)
      throw createError(400, 'Rating must be between 1 and 5.');

    const result = await db.query(
      `INSERT INTO product_reviews (product_id, user_id, rating, comment, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [productId, req.user.id, rating, comment || null]
    );

    res.status(201).json({ message: 'Review submitted.', review: result.rows[0] });
  } catch (err) {
    if (err.code === '42P01') {
      console.warn('[createProductReview] product_reviews table missing');
      return res.status(503).json({
        message: 'Reviews are temporarily unavailable. Please try again later.',
      });
    }
    // 23505 = unique_violation (user already reviewed this product)
    if (err.code === '23505') {
      return next(createError(409, 'You have already reviewed this product.'));
    }
    next(err);
  }
};

// ─── POST /api/admin/products  [Admin only] ───────────────────────────────────
const createProduct = async (req, res, next) => {
  try {
    const {
      name, description, price, stock,
      image_url, category_id, images,
      color, weight, sizes, size_stocks,
    } = req.body;

    if (price < 0) throw createError(400, 'Price must be non-negative.');

    const product = await ProductModel.create({
      name, description, price,
      stock:       stock       || 0,
      image_url,
      category_id,
      images:      images      || [],
      color:       color       || '',
      weight:      weight      || 500,
      sizes:       sizes       || [],
      size_stocks: size_stocks || {},
    });

    res.status(201).json({ message: 'Product created.', product });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/products/:id  [Admin only] ────────────────────────────────
const updateProduct = async (req, res, next) => {
  try {
    const product = await ProductModel.update(req.params.id, req.body);
    if (!product) throw createError(404, 'Product not found.');
    res.json({ message: 'Product updated.', product });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/admin/products/:id  [Admin only] ─────────────────────────────
const deleteProduct = async (req, res, next) => {
  try {
    const deleted = await ProductModel.delete(req.params.id);
    if (!deleted) throw createError(404, 'Product not found.');
    res.json({ message: 'Product deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProducts,
  getProduct,
  getProductReviews,
  createProductReview,
  createProduct,
  updateProduct,
  deleteProduct,
};
