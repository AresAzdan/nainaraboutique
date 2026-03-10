const ProductModel = require('../models/productModel');
const { createError } = require('../middleware/errorHandler');

// GET /api/products
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

// GET /api/products/:id
const getProduct = async (req, res, next) => {
  try {
    const product = await ProductModel.findById(req.params.id);
    if (!product) throw createError(404, 'Product not found.');
    res.json(product);
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/products  [Admin only]
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

// PUT /api/admin/products/:id  [Admin only]
const updateProduct = async (req, res, next) => {
  try {
    const product = await ProductModel.update(req.params.id, req.body);
    if (!product) throw createError(404, 'Product not found.');
    res.json({ message: 'Product updated.', product });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/products/:id  [Admin only]
const deleteProduct = async (req, res, next) => {
  try {
    const deleted = await ProductModel.delete(req.params.id);
    if (!deleted) throw createError(404, 'Product not found.');
    res.json({ message: 'Product deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getProducts, getProduct, createProduct, updateProduct, deleteProduct };
