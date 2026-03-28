const midtransClient = require('midtrans-client');
const db = require('../config/db');
const OrderModel = require('../models/orderModel');

// ─── Midtrans snap client ────────────────────────────────────────────────────
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resolveOrderId(midtransOrderId) {
  const { rows } = await db.query(
    `SELECT id FROM orders WHERE midtrans_order_id = $1 LIMIT 1`,
    [midtransOrderId]
  );
  if (rows.length > 0) return rows[0].id;

  const suffix = midtransOrderId.split('-').pop();
  const ts = parseInt(suffix, 10);
  if (!isNaN(ts)) {
    const tsDate = new Date(ts).toISOString();
    const { rows: fallbackRows } = await db.query(
      `SELECT id FROM orders
       ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - $1::timestamptz)))
       LIMIT 1`,
      [tsDate]
    );
    if (fallbackRows.length > 0) return fallbackRows[0].id;
  }

  return null;
}

function mapMidtransStatus(transactionStatus, fraudStatus) {
  switch (transactionStatus) {
    case 'capture':
      return fraudStatus === 'accept' ? 'paid' : 'fraud';
    case 'settlement':
      return 'paid';
    case 'pending':
      return 'pending';
    case 'deny':
    case 'cancel':
      return 'cancelled';
    case 'expire':
      return 'expired';
    case 'refund':
    case 'partial_refund':
      return 'refunded';
    case 'chargeback':
      return 'chargeback';
    default:
      return 'pending';
  }
}

// ─── Pool resolver ────────────────────────────────────────────────────────────
// Supports both { pool } and { query } export shapes from db config.
// If your db module exports a pool directly (module.exports = pool), pass it as-is.
// If it exports { pool, query }, we use pool.connect().
// If it only exports { query } (no pool), we fall back to db.query with manual client sim.
function getPool() {
  if (db && typeof db.connect === 'function') {
    // db IS the pool
    return db;
  }
  if (db && db.pool && typeof db.pool.connect === 'function') {
    // db has a .pool property
    return db.pool;
  }
  return null;
}

// ─── Controllers ─────────────────────────────────────────────────────────────

// POST /orders  — authenticated, create order from cart
exports.createOrder = async (req, res) => {
  console.log('[createOrder] ▶ entered');

  const userId = req.user.id;
  const {
    items,
    shippingAddress,
    shippingMethod,
    shippingCost = 0,
    discountAmount = 0,
    promoCode = null,
    phone = null,
    recipientName = null,
  } = req.body;

  if (!items || items.length === 0) {
    console.warn('[createOrder] ✖ no items in request body');
    return res.status(400).json({ message: 'No items provided' });
  }

  // ── Resolve pool ─────────────────────────────────────────────────────────
  // ROOT CAUSE FIX: db.pool.connect() throws TypeError when db has no .pool.
  // We detect the correct way to get a client from whatever db exports.
  const pool = getPool();

  if (!pool) {
    // db module doesn't expose a pool — fall back to non-transactional path
    // using db.query directly. This is safe for single-statement flows.
    console.warn(
      '[createOrder] ⚠ db.pool not available — falling back to db.query (no transaction).'
    );
    console.warn(
      '[createOrder] ⚠ Fix: export pool from your db config for full transaction support.'
    );
    return exports._createOrderNoPool(req, res, {
      userId, items, shippingAddress, shippingMethod,
      shippingCost, discountAmount, promoCode, phone, recipientName,
    });
  }

  // ── Happy path: full transaction ─────────────────────────────────────────
  let client;
  try {
    console.log('[createOrder] acquiring DB client from pool...');
    client = await pool.connect();
    console.log('[createOrder] ✔ DB client acquired');
  } catch (err) {
    console.error('[createOrder] ✖ Failed to acquire DB client:', err);
    return res.status(500).json({ message: 'Database connection failed', error: err.message });
  }

  try {
    await client.query('BEGIN');
    console.log('[createOrder] ✔ DB transaction BEGIN');

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const { rows } = await client.query(
          `SELECT name, price FROM products WHERE id = $1`,
          [item.product_id]
        );
        const product = rows[0];
        return {
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price ?? product?.price ?? 0,
          product_name: product?.name || item.product_name || null,
        };
      })
    );
    console.log('[createOrder] ✔ items enriched:', enrichedItems.length);

    const totalAmount =
      enrichedItems.reduce((sum, i) => sum + i.price * i.quantity, 0) +
      Number(shippingCost) -
      Number(discountAmount);

    console.log('[createOrder] ✔ totalAmount:', totalAmount);

    const order = await OrderModel.create(
      {
        userId,
        totalAmount,
        items: enrichedItems,
        shippingCost,
        discountAmount,
        promoCode,
        shippingAddress,
        shippingMethod,
        phone,
        recipientName,
      },
      client
    );
    console.log('[createOrder] ✔ order row created, id:', order.id);

    // ── Midtrans Snap ───────────────────────────────────────────────────────
    const midtransOrderId = `NAINARA-${Date.now()}`;
    console.log('[createOrder] ▶ calling snap.createTransaction for:', midtransOrderId);

    let snapResponse;
    try {
      snapResponse = await snap.createTransaction({
        transaction_details: {
          order_id: midtransOrderId,
          gross_amount: Math.round(totalAmount),
        },
        customer_details: {
          first_name: recipientName || req.user.name || 'Customer',
          email: req.user.email || '',
          phone: phone || '',
        },
      });
      console.log('[createOrder] ✔ snap.createTransaction succeeded, token:', snapResponse.token);
    } catch (midtransErr) {
      console.error('[createOrder] ✖ snap.createTransaction failed:', midtransErr);
      await client.query('ROLLBACK');
      client.release();
      client = null;
      return res.status(502).json({
        message: 'Payment gateway error. Please try again.',
        error: midtransErr.message,
      });
    }

    // Persist the Midtrans order_id
    await client.query(
      `UPDATE orders SET midtrans_order_id = $1 WHERE id = $2`,
      [midtransOrderId, order.id]
    );

    await client.query('COMMIT');
    console.log('[createOrder] ✔ DB transaction COMMIT');

    console.log('[createOrder] ▶ sending 201 response');
    return res.status(201).json({
      order,
      snapToken: snapResponse.token,
      snapRedirectUrl: snapResponse.redirect_url,
    });

  } catch (err) {
    console.error('[createOrder] ✖ unexpected error:', err);
    try {
      await client.query('ROLLBACK');
      console.log('[createOrder] ✔ ROLLBACK issued after error');
    } catch (rbErr) {
      console.error('[createOrder] ✖ ROLLBACK itself failed:', rbErr);
    }
    return res.status(500).json({ message: 'Failed to create order', error: err.message });
  } finally {
    if (client) {
      client.release();
      console.log('[createOrder] ✔ DB client released');
    }
  }
};

// ─── Fallback: no-pool path (uses db.query directly) ─────────────────────────
// Used when db module doesn't expose a pool. No DB-level transaction — if
// Midtrans fails after insert, you may need to clean up manually.
// Permanent fix: export pool from db config (see comment at top of file).
exports._createOrderNoPool = async (req, res, params) => {
  const {
    userId, items, shippingAddress, shippingMethod,
    shippingCost, discountAmount, promoCode, phone, recipientName,
  } = params;

  try {
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const { rows } = await db.query(
          `SELECT name, price FROM products WHERE id = $1`,
          [item.product_id]
        );
        const product = rows[0];
        return {
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price ?? product?.price ?? 0,
          product_name: product?.name || item.product_name || null,
        };
      })
    );

    const totalAmount =
      enrichedItems.reduce((sum, i) => sum + i.price * i.quantity, 0) +
      Number(shippingCost) -
      Number(discountAmount);

    const order = await OrderModel.create({
      userId, totalAmount, items: enrichedItems,
      shippingCost, discountAmount, promoCode,
      shippingAddress, shippingMethod, phone, recipientName,
    });

    const midtransOrderId = `NAINARA-${Date.now()}`;
    console.log('[createOrder/noPool] ▶ calling snap.createTransaction for:', midtransOrderId);

    let snapResponse;
    try {
      snapResponse = await snap.createTransaction({
        transaction_details: {
          order_id: midtransOrderId,
          gross_amount: Math.round(totalAmount),
        },
        customer_details: {
          first_name: recipientName || req.user.name || 'Customer',
          email: req.user.email || '',
          phone: phone || '',
        },
      });
      console.log('[createOrder/noPool] ✔ snap token:', snapResponse.token);
    } catch (midtransErr) {
      console.error('[createOrder/noPool] ✖ Midtrans failed:', midtransErr);
      return res.status(502).json({
        message: 'Payment gateway error. Please try again.',
        error: midtransErr.message,
      });
    }

    await db.query(
      `UPDATE orders SET midtrans_order_id = $1 WHERE id = $2`,
      [midtransOrderId, order.id]
    );

    console.log('[createOrder/noPool] ▶ sending 201 response');
    return res.status(201).json({
      order,
      snapToken: snapResponse.token,
      snapRedirectUrl: snapResponse.redirect_url,
    });

  } catch (err) {
    console.error('[createOrder/noPool] ✖ unexpected error:', err);
    return res.status(500).json({ message: 'Failed to create order', error: err.message });
  }
};

// POST /orders/guest  — no auth, guest checkout
exports.createGuestOrder = async (req, res) => {
  console.log('[createGuestOrder] ▶ entered');

  const {
    items,
    shippingAddress,
    shippingMethod,
    shippingCost = 0,
    discountAmount = 0,
    promoCode = null,
    phone = null,
    recipientName = null,
    guestEmail = null,
  } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'No items provided' });
  }

  const pool = getPool();
  if (!pool) {
    console.warn('[createGuestOrder] ⚠ db.pool not available — using db.query fallback');
  }

  let client;
  try {
    client = pool ? await pool.connect() : null;
    const q = client ? (sql, vals) => client.query(sql, vals) : (sql, vals) => db.query(sql, vals);

    if (client) await client.query('BEGIN');

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const { rows } = await q(`SELECT name, price FROM products WHERE id = $1`, [item.product_id]);
        const product = rows[0];
        return {
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price ?? product?.price ?? 0,
          product_name: product?.name || item.product_name || null,
        };
      })
    );

    const totalAmount =
      enrichedItems.reduce((sum, i) => sum + i.price * i.quantity, 0) +
      Number(shippingCost) -
      Number(discountAmount);

    const order = await OrderModel.create(
      { userId: null, totalAmount, items: enrichedItems, shippingCost, discountAmount, promoCode, shippingAddress, shippingMethod, phone, recipientName },
      client || undefined
    );

    const midtransOrderId = `NAINARA-${Date.now()}`;
    console.log('[createGuestOrder] ▶ calling snap.createTransaction:', midtransOrderId);

    let snapResponse;
    try {
      snapResponse = await snap.createTransaction({
        transaction_details: { order_id: midtransOrderId, gross_amount: Math.round(totalAmount) },
        customer_details: { first_name: recipientName || 'Guest', email: guestEmail || '', phone: phone || '' },
      });
      console.log('[createGuestOrder] ✔ snap token:', snapResponse.token);
    } catch (midtransErr) {
      console.error('[createGuestOrder] ✖ Midtrans failed:', midtransErr);
      if (client) { await client.query('ROLLBACK'); client.release(); client = null; }
      return res.status(502).json({ message: 'Payment gateway error. Please try again.', error: midtransErr.message });
    }

    await q(`UPDATE orders SET midtrans_order_id = $1 WHERE id = $2`, [midtransOrderId, order.id]);
    if (client) await client.query('COMMIT');

    console.log('[createGuestOrder] ▶ sending 201 response');
    return res.status(201).json({ order, snapToken: snapResponse.token, snapRedirectUrl: snapResponse.redirect_url });

  } catch (err) {
    console.error('[createGuestOrder] ✖ unexpected error:', err);
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return res.status(500).json({ message: 'Failed to create guest order', error: err.message });
  } finally {
    if (client) client.release();
  }
};

// GET /orders  — list authenticated user's orders
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await OrderModel.findByUserId(req.user.id);
    return res.json({ orders });
  } catch (err) {
    console.error('[getMyOrders]', err);
    return res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

// GET /orders/:id  — single order (own only)
exports.getMyOrder = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    const items = await OrderModel.getOrderItems(order.id);
    return res.json({ order, items });
  } catch (err) {
    console.error('[getMyOrder]', err);
    return res.status(500).json({ message: 'Failed to fetch order' });
  }
};

// GET /orders/guest/:id  — guest order lookup (no auth)
exports.getGuestOrder = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user_id !== null) return res.status(403).json({ message: 'Forbidden' });
    const items = await OrderModel.getOrderItems(order.id);
    return res.json({ order, items });
  } catch (err) {
    console.error('[getGuestOrder]', err);
    return res.status(500).json({ message: 'Failed to fetch guest order' });
  }
};

// PATCH /orders/:id/status  — user manually marks as paid
exports.updateOrderStatus = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    const updated = await OrderModel.updateStatus(order.id, req.body.status);
    return res.json({ order: updated });
  } catch (err) {
    console.error('[updateOrderStatus]', err);
    return res.status(500).json({ message: 'Failed to update status' });
  }
};

// PATCH /orders/:id/cancel  — user cancels a pending order
exports.cancelOrder = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    if (order.status !== 'pending') {
      return res.status(400).json({ message: `Cannot cancel an order with status "${order.status}"` });
    }
    const updated = await OrderModel.updateStatus(order.id, 'cancelled');
    return res.json({ order: updated });
  } catch (err) {
    console.error('[cancelOrder]', err);
    return res.status(500).json({ message: 'Failed to cancel order' });
  }
};

// ─── Admin controllers ────────────────────────────────────────────────────────

exports.getAllOrders = async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM orders ORDER BY created_at DESC`);
    return res.json({ orders: rows });
  } catch (err) {
    console.error('[getAllOrders]', err);
    return res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

exports.adminGetOrder = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const items = await OrderModel.getOrderItems(order.id);
    return res.json({ order, items });
  } catch (err) {
    console.error('[adminGetOrder]', err);
    return res.status(500).json({ message: 'Failed to fetch order' });
  }
};

exports.adminUpdateOrderStatus = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const updated = await OrderModel.updateStatus(order.id, req.body.status);
    return res.json({ order: updated });
  } catch (err) {
    console.error('[adminUpdateOrderStatus]', err);
    return res.status(500).json({ message: 'Failed to update order status' });
  }
};

// POST /orders/midtrans/notification  — Midtrans webhook (public)
exports.midtransNotification = async (req, res) => {
  try {
    const notification = await snap.transaction.notification(req.body);
    const {
      order_id: midtransOrderId,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
    } = notification;

    console.log('[midtransNotification] received:', { midtransOrderId, transactionStatus, fraudStatus });

    const dbOrderId = await resolveOrderId(midtransOrderId);
    if (!dbOrderId) {
      console.error('[midtransNotification] Could not resolve DB id for:', midtransOrderId);
      return res.status(200).json({ message: 'Order not found, skipping' });
    }

    const newStatus = mapMidtransStatus(transactionStatus, fraudStatus);
    console.log(`[midtransNotification] Updating order #${dbOrderId} → "${newStatus}"`);

    const updated = await OrderModel.updateStatus(dbOrderId, newStatus);
    if (!updated) {
      console.warn('[midtransNotification] updateStatus returned null for id:', dbOrderId);
    }

    return res.status(200).json({ message: 'OK', orderId: dbOrderId, status: newStatus });
  } catch (err) {
    console.error('[midtransNotification] error:', err);
    return res.status(200).json({ message: 'Webhook processing error' });
  }
};
