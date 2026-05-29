const CartModel    = require('../models/cartModel');
const ProductModel = require('../models/productModel');
const { createError } = require('../middleware/errorHandler');
const { getVariantStock, normalizeColor, normalizeSize } = require('../utils/stockProtection');

// GET /api/cart
const getCart = async (req, res, next) => {
  try {
    const cart = await CartModel.getCartWithItems(req.user.id);
    res.json(cart);
  } catch (err) {
    next(err);
  }
};

// POST /api/cart  — add item
const addToCart = async (req, res, next) => {
  try {
    const { product_id, quantity = 1 } = req.body;
    const size = normalizeSize(req.body.size);
    const color = normalizeColor(req.body.color);
    if (!product_id) throw createError(400, 'product_id is required.');
    if (quantity < 1) throw createError(400, 'Quantity must be at least 1.');

    const product = await ProductModel.findById(product_id);
    if (!product) throw createError(404, 'Product not found.');
    const availableStock = getVariantStock(product, size, color);
    const existingQty = await CartModel.getItemQuantity(req.user.id, product_id, size, color);
    const requestedQty = existingQty + quantity;
    if (availableStock < requestedQty) throw createError(400, `Only ${availableStock} left in stock.`);
    const existingQty = await CartModel.getItemQuantity(req.user.id, product_id);
    const requestedQty = existingQty + quantity;
    if (product.stock < requestedQty) throw createError(400, `Only ${product.stock} left in stock.`);

    const item = await CartModel.addOrUpdateItem(req.user.id, product_id, quantity, size, color);
    res.status(201).json({ message: 'Item added to cart.', item });
  } catch (err) {
    next(err);
  }
};

// PUT /api/cart/:product_id  — update quantity
const updateCartItem = async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const size = normalizeSize(req.body.size);
    const color = normalizeColor(req.body.color);
    if (!quantity || quantity < 1) throw createError(400, 'Quantity must be at least 1.');

    const product = await ProductModel.findById(req.params.product_id);
    if (!product) throw createError(404, 'Product not found.');
    const availableStock = getVariantStock(product, size, color);
    if (availableStock < quantity) throw createError(400, `Only ${availableStock} left in stock.`);
    if (product.stock < quantity) throw createError(400, `Only ${product.stock} left in stock.`);

    const item = await CartModel.updateItemQuantity(
      req.user.id,
      req.params.product_id,
      quantity,
      size,
      color
    );
    if (!item) throw createError(404, 'Item not in cart.');
    res.json({ message: 'Cart item updated.', item });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/cart/:product_id  — remove item
const removeFromCart = async (req, res, next) => {
  try {
    const size = normalizeSize(req.body?.size || req.query?.size);
    const color = normalizeColor(req.body?.color || req.query?.color);
    const removed = await CartModel.removeItem(req.user.id, req.params.product_id, size, color);
    if (!removed) throw createError(404, 'Item not in cart.');
    res.json({ message: 'Item removed from cart.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCart, addToCart, updateCartItem, removeFromCart };
