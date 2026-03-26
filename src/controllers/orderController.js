const db           = require('../config/db');
const OrderModel   = require('../models/orderModel');
const CartModel    = require('../models/cartModel');
const ProductModel = require('../models/productModel');
const { createError } = require('../middleware/errorHandler');

// Setup Midtrans Client
const midtransClient = require('midtrans-client');
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

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

    const existingPending = await client.query(
      'SELECT id FROM orders WHERE user_id = $1 AND status = $2 LIMIT 1',
      [req.user.id, 'pending']
    );
    if (existingPending.rows.length > 0) {
      throw createError(400, 'You have an unpaid order. Please complete payment first.');
    }

    await client.query('BEGIN');

    const { cart_id, items } = await CartModel.getCartWithItems(req.user.id);
    if (items.length === 0) throw createError(400, 'Your cart is empty.');

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

    const discountVal = Math.min(parseFloat(discount_amount) || 0, subtotal);
    const shippingVal = parseFloat(shipping_cost) || 0;
    const totalAmount = Math.max(0, subtotal - discountVal + shippingVal);

    const fullAddress = [address, district, city, province, postal_code].filter(Boolean).join(', ');
    const shippingMethod = [courier, shipping_service].filter(Boolean).join(' - ');

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

    if (promo_code) {
      try {
        const { redeemPromoCode } = require('./promoController');
        const promoResult = await client.query('SELECT id FROM promo_codes WHERE code = $1', [promo_code.toUpperCase()]);
        if (promoResult.rows[0]) {
          await client.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1', [promoResult.rows[0].id]);
          await client.query('INSERT INTO promo_code_uses (promo_id, user_id) VALUES ($1, $2)', [promoResult.rows[0].id, req.user.id]);
        }
      } catch (e) { }
    }

    await CartModel.clearCart(cart_id, client);
    await client.query('COMMIT');

    const orderItems2 = await OrderModel.getOrderItems(order.id);

    // Minta token ke Midtrans
    const parameter = {
      transaction_details: {
        order_id: `NAINARA-USER-${order.id}-${Date.now()}`,
        gross_amount: Math.round(totalAmount)
      },
      customer_details: {
        first_name: req.user.name || name || 'User',
        email: req.user.email || 'user@example.com',
        phone: phone || req.user.phone || '08000000000'
      }
    };
    const transaction = await snap.createTransaction(parameter);

    res.status(201).json({
      message: 'Order placed successfully.',
      order: { ...order, items: orderItems2 },
      snap_token: transaction.token // <- Token Midtrans dikirim ke frontend
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

const getMyOrders = async (req, res, next) => {
  try {
    const orders = await OrderModel.findByUserId(req.user.id);
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

const getMyOrder = async (req, res, next) => {
  try {
    let order = await OrderModel.findById(req.params.id);
    if (!order) throw createError(404, 'Order not found.');
    if (order.user_id !== req.user.id) return res.status(403).json({ message: 'Unauthorized access' });
    order = await expireOrderIfStale(order);
    if (req.user.role !== 'admin' && order.user_id !== req.user.id) throw createError(403, 'Access denied.');
    const items = await OrderModel.getOrderItems(order.id);
    res.json({ ...order, items });
  } catch (err) {
    next(err);
  }
};

const getAllOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const orders = await OrderModel.findAll({ page: Number(page), limit: Number(limit) });
    res.json({ page: Number(page), limit: Number(limit), data: orders });
  } catch (err) {
    next(err);
  }
};

const updateOrderStatus = async (req, res, next) => {
  const client = await db.connect();
  try {
    const { status } = req.body;
    if (!status) throw createError(400, 'Status is required.');

    let order = await OrderModel.findById(req.params.id);
    if (!order) throw createError(404, 'Order not found.');
    if (order.user_id !== req.user.id) return res.status(403).json({ message: 'Unauthorized access' });

    order = await expireOrderIfStale(order, client);

    if (order.status !== 'pending') throw createError(400, 'Only pending orders can be paid.');
    if (status !== 'paid') throw createError(400, 'Only "paid" status is allowed via this endpoint.');

    await client.query('BEGIN');

    const items = await OrderModel.getOrderItems(order.id);
    for (const item of items) {
      const result = await ProductModel.deductStock(item.product_id, item.quantity, client);
      if (!result) throw createError(409, `Insufficient stock for product ID ${item.product_id}. Cannot mark as paid.`);
    }

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

const cancelOrder = async (req, res, next) => {
  const client = await db.connect();
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) throw createError(404, 'Order not found.');
    if (order.user_id !== req.user.id) return res.status(403).json({ message: 'Unauthorized access' });

    const cancellable = ['pending', 'paid', 'processing'];
    if (!cancellable.includes(order.status)) throw createError(400, 'Only orders that have not been shipped can be cancelled.');

    await client.query('BEGIN');

    if (['paid', 'processing'].includes(order.status)) {
      const items = await OrderModel.getOrderItems(order.id);
      for (const item of items) {
        await client.query(
          'UPDATE products SET stock = stock + $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }
    }

    const result = await client.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      ['cancelled', req.params.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Order cancelled successfully.', order: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

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

// POST /api/orders/guest  — create order without authentication (guest checkout)
const createGuestOrder = async (req, res, next) => {
  const client = await db.connect();
  try {
    const {
      name = null,
      phone = null,
      email = null,
      address = '',
      province = '',
      city = '',
      district = '',
      postal_code = '',
      courier = 'free',
      shipping_service = 'Free Shipping',
      shipping_cost = 0,
      discount_amount = 0,
      promo_code = null,
      total_amount,
      items = [],
    } = req.body;

    if (!items || items.length === 0) throw createError(400, 'No items provided.');
    if (!total_amount) throw createError(400, 'total_amount is required.');

    await client.query('BEGIN');

    const fullAddress = [address, district, city, province, postal_code].filter(Boolean).join(', ');
    const shippingMethod = [courier, shipping_service].filter(Boolean).join(' - ');

    const discountVal = parseFloat(discount_amount) || 0;
    const shippingVal = parseFloat(shipping_cost) || 0;
    const totalAmountVal = parseFloat(total_amount);

    const orderResult = await client.query(
      `INSERT INTO orders
        (user_id, total_amount, shipping_cost, discount_amount, promo_code,
         shipping_address, shipping_method, phone, recipient_name, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending', NOW())
       RETURNING *`,
      [
        null, totalAmountVal, shippingVal, discountVal, promo_code || null,
        fullAddress || null, shippingMethod || null, phone || null, name || null,
      ]
    );
    const order = orderResult.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price, product_name, size)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          order.id, item.product_id || null, item.quantity || 1, parseFloat(item.price) || 0,
          item.product_name || item.name || 'Product', item.size || null,
        ]
      );
    }

    await client.query('COMMIT');

    const orderItemsResult = await client.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);

    // Minta token ke Midtrans buat Guest
    const parameter = {
      transaction_details: {
        order_id: `NAINARA-GUEST-${order.id}-${Date.now()}`,
        gross_amount: Math.round(totalAmountVal)
      },
      customer_details: {
        first_name: name || 'Guest',
        email: email || 'guest@example.com',
        phone: phone || '08000000000'
      }
    };
    console.log("=== DEBUG MIDTRANS ===");
    console.log("IS PROD:", process.env.MIDTRANS_IS_PRODUCTION);
    console.log("SERVER KEY:", process.env.MIDTRANS_SERVER_KEY);
    console.log("======================");
    console.log('MODE:', snap.apiConfig.isProduction, 'KUNCI:', snap.apiConfig.serverKey);
    const transaction = await snap.createTransaction(parameter);

    res.status(201).json({
      message: 'Guest order placed successfully.',
      order: { ...order, items: orderItemsResult.rows },
      snap_token: transaction.token // <- Token Midtrans dikirim ke frontend
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

const midtransNotification = async (req, res) => {
  try {
    console.log("=== MIDTRANS NOTIFICATION ===");
    console.log(req.body);

    const { order_id, transaction_status } = req.body;

    console.log("Order ID:", order_id);
    console.log("Status:", transaction_status);

    // 🔥 UPDATE STATUS DI DATABASE
    if (transaction_status === 'settlement') {
      await OrderModel.updateStatus(order_id, 'paid');
    }

    if (transaction_status === 'pending') {
      await OrderModel.updateStatus(order_id, 'pending');
    }

    if (['deny', 'cancel', 'expire'].includes(transaction_status)) {
      await OrderModel.updateStatus(order_id, 'failed');
    }

    res.status(200).json({ message: "OK" });
  } catch (err) {
    console.error("Notification error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  createOrder,
  createGuestOrder,
  getMyOrders,
  getMyOrder,
  updateOrderStatus,
  cancelOrder,
  midtransNotification,
  adminGetOrder,
  getAllOrders,
  adminUpdateOrderStatus,
};
