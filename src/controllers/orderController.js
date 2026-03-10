const db           = require('../config/db');
const OrderModel   = require('../models/orderModel');
const CartModel    = require('../models/cartModel');
const ProductModel = require('../models/productModel');
const { createError } = require('../middleware/errorHandler');

const VALID_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'completed', 'cancelled', 'return_requested', 'returned'];

// Helper: lazily expire a pending order if older than 24 hours
const expireOrderIfStale = async (order, clientOrDb = db) => {
  if (order.status !== 'pending') return order;
  const diffHours = (new Date() - new Date(order.created_at)) / (1000 * 60 * 60);
  if (diffHours < 24) return order;

  const result = await clientOrDb.query(
    'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
    ['cancelled', order.id]
  );
  return result.rows[0];
};

// POST /api/orders  — create order from current cart
const createOrder = async (req, res, next) => {
  const client = await db.connect();
  try {
    const {
      shipping_cost = 0,
      discount_amount = 0,
      promo_code = null,
      name = null,
      phone = null,
      address = '',
      province = '',
      city = '',
      district = '',
      postal_code = '',
      courier = '',
      shipping_service = ''
    } = req.body;

    // 0. Check for existing unpaid (pending) order before starting transaction
    const existingPending = await client.query(
      'SELECT id FROM orders WHERE user_id = $1 AND status = $2 LIMIT 1',
      [req.user.id, 'pending']
    );
    if (existingPending.rows.length > 0) {
      throw createError(400, 'You have an unpaid order. Please complete payment first.');
    }

    await client.query('BEGIN');

    // 1. Get user's cart
    const { cart_id, items } = await CartModel.getCartWithItems(req.user.id);
    if (items.length === 0) throw createError(400, 'Your cart is empty.');

    // 2. Validate stock and compute subtotal
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      if (item.stock < item.quantity) {
        throw createError(
          400,
          `Insufficient stock for "${item.name}". Available: ${item.stock}.`
        );
      }
      const lineTotal = parseFloat(item.price) * item.quantity;
      subtotal += lineTotal;
      orderItems.push({
        product_id: item.product_id,
        quantity:   item.quantity,
        price:      parseFloat(item.price),
      });
    }

    // 3. Apply discount and shipping to compute final total
    const discountVal = Math.min(parseFloat(discount_amount) || 0, subtotal);
    const shippingVal = parseFloat(shipping_cost) || 0;
    const totalAmount = Math.max(0, subtotal - discountVal + shippingVal);

    // Build shipping address string
    const fullAddress = [address, district, city, province, postal_code].filter(Boolean).join(', ');
    const shippingMethod = [courier, shipping_service].filter(Boolean).join(' - ');

    // 4. Create order + order_items inside transaction
    const order = await OrderModel.create(
      {
        userId: req.user.id,
        totalAmount,
        items: orderItems,
        shippingCost: shippingVal,
        discountAmount: discountVal,
        promoCode: promo_code || null,
        shippingAddress: fullAddress || null,
        shippingMethod: shippingMethod || null,
        phone: phone || null,
        recipientName: name || null
      },
      client
    );

    // 5. If promo code was used, redeem it
    if (promo_code) {
      try {
        const { redeemPromoCode } = require('./promoController');
        const promoResult = await client.query('SELECT id FROM promo_codes WHERE code = $1', [promo_code.toUpperCase()]);
        if (promoResult.rows[0]) {
          await client.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1', [promoResult.rows[0].id]);
          await client.query('INSERT INTO promo_code_uses (promo_id, user_id) VALUES ($1, $2)', [promoResult.rows[0].id, req.user.id]);
        }
      } catch (e) { /* promo redemption failure is non-blocking */ }
    }

    // 6. Clear the cart
    await CartModel.clearCart(cart_id, client);

    await client.query('COMMIT');

    // Return full order detail
    const orderItems2 = await OrderModel.getOrderItems(order.id);
    res.status(201).json({
      message: 'Order placed successfully.',
      order: { ...order, items: orderItems2 },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/orders  — user's own orders
const getMyOrders = async (req, res, next) => {
  try {
    const orders = await OrderModel.findByUserId(req.user.id);

    // Lazy expiry + attach items to each order
    const detailed = await Promise.all(
      orders.map(async (order) => {
        const maybeExpired = await expireOrderIfStale(order);
        return {
          ...maybeExpired,
          items: await OrderModel.getOrderItems(maybeExpired.id),
        };
      })
    );

    res.json(detailed);
  } catch (err) {
    next(err);
  }
};

// GET /api/orders/:id  — user's single order (own only)
const getMyOrder = async (req, res, next) => {
  try {
    let order = await OrderModel.findById(req.params.id);
    if (!order) throw createError(404, 'Order not found.');

    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    // Lazy expiry check
    order = await expireOrderIfStale(order);

    // Users can only see their own orders
    if (req.user.role !== 'admin' && order.user_id !== req.user.id) {
      throw createError(403, 'Access denied.');
    }

    const items = await OrderModel.getOrderItems(order.id);
    res.json({ ...order, items });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────

// GET /api/admin/orders
const getAllOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const orders = await OrderModel.findAll({ page: Number(page), limit: Number(limit) });
    res.json({ page: Number(page), limit: Number(limit), data: orders });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/orders/:id/status
// Only allows: pending → paid
const updateOrderStatus = async (req, res, next) => {
  const client = await db.connect();
  try {
    const { status } = req.body;
    if (!status) throw createError(400, 'Status is required.');

    // 1. Fetch order and check existence
    let order = await OrderModel.findById(req.params.id);
    console.log("ORDER STATUS FROM DB:", order.status);
    if (!order) throw createError(404, 'Order not found.');

    // 2. Ownership check
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    // Lazy expiry check (runs before BEGIN, commits independently)
    order = await expireOrderIfStale(order, client);

    // 3. Only allow transition: pending → paid
    if (order.status !== 'pending') {
      throw createError(400, 'Only pending orders can be paid.');
    }
    if (status !== 'paid') {
      throw createError(400, 'Only "paid" status is allowed via this endpoint.');
    }

    await client.query('BEGIN');

    // 4. Auto-deduct inventory
    const items = await OrderModel.getOrderItems(order.id);
    for (const item of items) {
      const result = await ProductModel.deductStock(item.product_id, item.quantity, client);
      if (!result) {
        throw createError(
          409,
          `Insufficient stock for product ID ${item.product_id}. Cannot mark as paid.`
        );
      }
    }

    // 5. Update status only after all validations pass
    const updated = await client.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ message: `Order status updated to "${status}".`, order: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// PATCH /api/orders/:id/cancel
// Only allows: pending → cancelled
const cancelOrder = async (req, res, next) => {
  const client = await db.connect();
  try {
    // 1. Fetch order and check existence
    const order = await OrderModel.findById(req.params.id);
    if (!order) throw createError(404, 'Order not found.');

    // 2. Ownership check
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    // 3. Only orders that haven't shipped can be cancelled
    const cancellable = ['pending', 'paid', 'processing'];
    if (!cancellable.includes(order.status)) {
      throw createError(400, 'Only orders that have not been shipped can be cancelled.');
    }

    await client.query('BEGIN');

    // 4. If order was paid/processing, restore stock
    if (['paid', 'processing'].includes(order.status)) {
      const items = await OrderModel.getOrderItems(order.id);
      for (const item of items) {
        await client.query(
          'UPDATE products SET stock = stock + $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }
    }

    // 5. Update status to cancelled
    const result = await client.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      ['cancelled', req.params.id]
    );

    await client.query('COMMIT');

    // 6. Return updated order
    res.json({ message: 'Order cancelled successfully.', order: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// PUT /api/admin/orders/:id/status   [Admin only]
// Allows any valid status transition.
// IMPORTANT: When status is set to 'completed', delivered_at is automatically recorded.
const adminUpdateOrderStatus = async (req, res, next) => {
  const client = await db.connect();
  try {
    const { status, tracking_number, tracking_courier } = req.body;
    if (!VALID_STATUSES.includes(status)) throw createError(400, `Invalid status.`);

    let order = await OrderModel.findById(req.params.id);
    if (!order) throw createError(404, 'Order not found.');

    if (order.status === status) return res.json({ message: `Already "${status}".`, order });

    await client.query('BEGIN');

    if (status === 'paid' && !['paid','shipped','completed'].includes(order.status)) {
      const items = await OrderModel.getOrderItems(order.id);
      for (const item of items) {
        const ok = await ProductModel.deductStock(item.product_id, item.quantity, client);
        if (!ok) throw createError(409, `Insufficient stock for product ID ${item.product_id}.`);
      }
    }

    let updated;
    if (status === 'completed') {
      updated = await client.query(
        'UPDATE orders SET status = $1, delivered_at = NOW() WHERE id = $2 RETURNING *',
        [status, req.params.id]
      );
    } else if (status === 'shipped') {
      updated = await client.query(
        'UPDATE orders SET status = $1, tracking_number = COALESCE($2, tracking_number), tracking_courier = COALESCE($3, tracking_courier) WHERE id = $4 RETURNING *',
        [status, tracking_number || null, tracking_courier || null, req.params.id]
      );
    } else {
      updated = await client.query(
        'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
        [status, req.params.id]
      );
    }

    await client.query('COMMIT');
    res.json({ message: `Order updated to "${status}".`, order: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/admin/orders/:id  [Admin only]
const adminGetOrder = async (req, res, next) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) throw createError(404, 'Order not found.');
    const items = await OrderModel.getOrderItems(order.id);
    res.json({ ...order, items });
  } catch (err) {
    next(err);
  }
};

module.exports = { createOrder, getMyOrders, getMyOrder, getAllOrders, updateOrderStatus, cancelOrder, adminUpdateOrderStatus, adminGetOrder };
