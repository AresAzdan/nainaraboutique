const midtransClient = require('midtrans-client');
const db = require('../config/db');
const OrderModel = require('../models/orderModel');
const ProductModel = require('../models/productModel');
const { buildPricedOrderItems, calculateOrderTotal, buildMidtransSnapPayload } = require('../utils/orderPricing');
const { validateOrderStock } = require('../utils/stockProtection');
const refundService = require('../services/refundService');
const {
  buildAdminOrderDetailUrl,
  buildCustomerOrderDetailUrl,
  sendAdminRefundRequestNotification,
  sendCustomerOrderCancelledEmail,
  sendCustomerOrderShippedEmail,
  sendCustomerRefundStatusEmail,
} = require('../services/emailService');

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


const getRequestBaseUrl = (req) => {
  if (!req || typeof req.get !== 'function') return undefined;
  const host = req.get('host');
  return host ? `${req.protocol}://${host}` : undefined;
};

const getCustomerOrderDetailUrl = (req, orderId) => buildCustomerOrderDetailUrl({
  orderId,
  baseUrl: process.env.PUBLIC_SITE_URL || getRequestBaseUrl(req),
});

const getAdminOrderDetailUrl = (req, orderId) => buildAdminOrderDetailUrl({
  orderId,
  baseUrl: getRequestBaseUrl(req),
});

const getCustomerEmail = (order) => order && (order.customer_email || order.user_email);

const claimOrderEmail = async (orderId, columnName) => {
  const allowedColumns = new Set([
    'customer_refund_requested_email_sent_at',
    'customer_refund_result_email_sent_at',
    'customer_cancelled_email_sent_at',
    'customer_shipped_email_sent_at',
    'admin_refund_notified_at',
  ]);
  if (!allowedColumns.has(columnName)) {
    throw new Error(`Unsupported order email claim column: ${columnName}`);
  }
  const { rows } = await db.query(
    `UPDATE orders
     SET ${columnName} = NOW()
     WHERE id = $1 AND ${columnName} IS NULL
     RETURNING ${columnName}`,
    [orderId]
  );
  return rows.length > 0;
};

const getOrderAndItemsForEmail = async (orderId) => {
  const order = await OrderModel.findById(orderId);
  if (!order) return { order: null, items: [] };
  const items = await OrderModel.getOrderItems(orderId);
  return { order, items };
};

const extractRejectionReason = (order) => {
  const response = order && order.refund_midtrans_response;
  if (!response) return null;
  if (typeof response === 'string') {
    try {
      return JSON.parse(response).rejection_reason || null;
    } catch (_err) {
      return null;
    }
  }
  return response.rejection_reason || null;
};

const notifyCustomerRefund = async ({ req, orderId, status, claimColumn, reason }) => {
  try {
    const shouldSend = await claimOrderEmail(orderId, claimColumn);
    if (!shouldSend) return;
    const { order, items } = await getOrderAndItemsForEmail(orderId);
    if (!order) {
      console.error(`[OrderEmail] Customer refund email skipped: order ${orderId} not found.`);
      return;
    }
    const to = getCustomerEmail(order);
    if (!to) {
      console.error(`[OrderEmail] Customer refund email skipped: order ${orderId} has no customer email.`);
      return;
    }
    await sendCustomerRefundStatusEmail({
      to,
      order,
      items,
      status,
      reason,
      orderDetailUrl: getCustomerOrderDetailUrl(req, orderId),
    });
  } catch (err) {
    console.error(`[OrderEmail] Failed to send customer refund email for order ${orderId}:`, err);
  }
};

const notifyAdminRefundRequest = async ({ req, orderId }) => {
  try {
    const shouldSend = await claimOrderEmail(orderId, 'admin_refund_notified_at');
    if (!shouldSend) return;
    const { order, items } = await getOrderAndItemsForEmail(orderId);
    if (!order) {
      console.error(`[OrderEmail] Admin refund email skipped: order ${orderId} not found.`);
      return;
    }
    await sendAdminRefundRequestNotification({
      order,
      items,
      adminOrderDetailUrl: getAdminOrderDetailUrl(req, orderId),
    });
  } catch (err) {
    console.error(`[OrderEmail] Failed to send admin refund email for order ${orderId}:`, err);
  }
};

const notifyCustomerCancelledOrder = async ({ req, orderId }) => {
  try {
    const shouldSend = await claimOrderEmail(orderId, 'customer_cancelled_email_sent_at');
    if (!shouldSend) return;
    const { order, items } = await getOrderAndItemsForEmail(orderId);
    if (!order) {
      console.error(`[OrderEmail] Cancelled email skipped: order ${orderId} not found.`);
      return;
    }
    const to = getCustomerEmail(order);
    if (!to) {
      console.error(`[OrderEmail] Cancelled email skipped: order ${orderId} has no customer email.`);
      return;
    }
    await sendCustomerOrderCancelledEmail({
      to,
      order,
      items,
      orderDetailUrl: getCustomerOrderDetailUrl(req, orderId),
    });
  } catch (err) {
    console.error(`[OrderEmail] Failed to send cancelled email for order ${orderId}:`, err);
  }
};

const notifyCustomerShippedOrder = async ({ req, orderId }) => {
  try {
    const shouldSend = await claimOrderEmail(orderId, 'customer_shipped_email_sent_at');
    if (!shouldSend) return;
    const { order, items } = await getOrderAndItemsForEmail(orderId);
    if (!order) {
      console.error(`[OrderEmail] Shipped email skipped: order ${orderId} not found.`);
      return;
    }
    const to = getCustomerEmail(order);
    if (!to) {
      console.error(`[OrderEmail] Shipped email skipped: order ${orderId} has no customer email.`);
      return;
    }
    await sendCustomerOrderShippedEmail({
      to,
      order,
      items,
      orderDetailUrl: getCustomerOrderDetailUrl(req, orderId),
    });
  } catch (err) {
    console.error(`[OrderEmail] Failed to send shipped email for order ${orderId}:`, err);
  }
};

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

    await validateOrderStock(items, client, { forUpdate: true });

    const pricingSnapshots = await ProductModel.getOrderPricingSnapshots(items, client);
    const enrichedItems = buildPricedOrderItems(items, pricingSnapshots);
    console.log('[createOrder] ✔ items enriched:', enrichedItems.length);

    const totalAmount = calculateOrderTotal({
      items: enrichedItems,
      shippingCost,
      discountAmount,
    });

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
        customerEmail: req.user.email || null,
      },
      client
    );
    console.log('[createOrder] ✔ order row created, id:', order.id);

    // ── Midtrans Snap ───────────────────────────────────────────────────────
    const midtransOrderId = `NAINARA-${Date.now()}`;
    console.log('[createOrder] ▶ calling snap.createTransaction for:', midtransOrderId);

    let snapResponse;
    try {
      snapResponse = await snap.createTransaction(buildMidtransSnapPayload({
        orderId: midtransOrderId,
        grossAmount: Math.round(totalAmount),
        items: enrichedItems,
        shippingCost,
        discountAmount,
        customer: {
          firstName: recipientName || req.user.name || 'Customer',
          email: req.user.email || '',
          phone: phone || '',
          shippingAddress,
        },
      }));
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
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to create order', error: err.status ? undefined : err.message });
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
    await validateOrderStock(items, db);

    const pricingSnapshots = await ProductModel.getOrderPricingSnapshots(items, db);
    const enrichedItems = buildPricedOrderItems(items, pricingSnapshots);

    const totalAmount = calculateOrderTotal({
      items: enrichedItems,
      shippingCost,
      discountAmount,
    });

    const order = await OrderModel.create({
      userId, totalAmount, items: enrichedItems,
      shippingCost, discountAmount, promoCode,
      shippingAddress, shippingMethod, phone, recipientName, customerEmail: req.user.email || null,
    }, db);

    const midtransOrderId = `NAINARA-${Date.now()}`;
    console.log('[createOrder/noPool] ▶ calling snap.createTransaction for:', midtransOrderId);

    let snapResponse;
    try {
      snapResponse = await snap.createTransaction(buildMidtransSnapPayload({
        orderId: midtransOrderId,
        grossAmount: Math.round(totalAmount),
        items: enrichedItems,
        shippingCost,
        discountAmount,
        customer: {
          firstName: recipientName || req.user.name || 'Customer',
          email: req.user.email || '',
          phone: phone || '',
          shippingAddress,
        },
      }));
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
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to create order', error: err.status ? undefined : err.message });
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

    const queryable = client || db;
    await validateOrderStock(items, queryable, { forUpdate: !!client });

    const pricingSnapshots = await ProductModel.getOrderPricingSnapshots(items, queryable);
    const enrichedItems = buildPricedOrderItems(items, pricingSnapshots);

    const totalAmount = calculateOrderTotal({
      items: enrichedItems,
      shippingCost,
      discountAmount,
    });

    const order = await OrderModel.create(
      { userId: null, totalAmount, items: enrichedItems, shippingCost, discountAmount, promoCode, shippingAddress, shippingMethod, phone, recipientName, customerEmail: guestEmail || null },
      client || db
    );

    const midtransOrderId = `NAINARA-${Date.now()}`;
    console.log('[createGuestOrder] ▶ calling snap.createTransaction:', midtransOrderId);

    let snapResponse;
    try {
      snapResponse = await snap.createTransaction(buildMidtransSnapPayload({
        orderId: midtransOrderId,
        grossAmount: Math.round(totalAmount),
        items: enrichedItems,
        shippingCost,
        discountAmount,
        customer: {
          firstName: recipientName || 'Guest',
          email: guestEmail || '',
          phone: phone || '',
          shippingAddress,
        },
      }));
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
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to create guest order', error: err.status ? undefined : err.message });
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
    if (Number(order.user_id) !== Number(req.user.id)) return res.status(403).json({ message: 'Forbidden' });
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
    if (Number(order.user_id) !== Number(req.user.id)) return res.status(403).json({ message: 'Forbidden' });
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
    if (Number(order.user_id) !== Number(req.user.id)) return res.status(403).json({ message: 'Forbidden' });
    if (order.status !== 'pending') {
      return res.status(400).json({ message: `Cannot cancel an order with status "${order.status}"` });
    }
    const updated = await OrderModel.updateStatus(order.id, 'cancelled');
    await notifyCustomerCancelledOrder({ req, orderId: order.id });
    return res.json({ order: updated });
  } catch (err) {
    console.error('[cancelOrder]', err);
    return res.status(500).json({ message: 'Failed to cancel order' });
  }
};


// POST /orders/:id/refund-request — customer requests a refund without calling Midtrans
exports.requestRefund = async (req, res) => {
  try {
    const order = await refundService.requestRefund({
      orderId: req.params.id,
      userId: req.user.id,
      reason: req.body.reason,
      refundAmount: req.body.refundAmount ?? req.body.refund_amount,
    });
    await Promise.all([
      notifyCustomerRefund({
        req,
        orderId: order.id,
        status: 'requested',
        claimColumn: 'customer_refund_requested_email_sent_at',
      }),
      notifyAdminRefundRequest({ req, orderId: order.id }),
    ]);
    return res.status(201).json({ order });
  } catch (err) {
    console.error('[requestRefund]', err);
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to request refund' });
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
    const body = req.body || {};
    const status = String(body.status || '').trim().toLowerCase();
    const trackingNumber = typeof body.tracking_number === 'string'
      ? body.tracking_number.trim()
      : body.tracking_number;
    const trackingCourier = typeof body.tracking_courier === 'string'
      ? body.tracking_courier.trim()
      : body.tracking_courier;

    if (status === 'shipped') {
      if (!trackingNumber) {
        return res.status(400).json({ message: 'Tracking number is required when status is shipped' });
      }
      if (!trackingCourier) {
        return res.status(400).json({ message: 'Tracking courier is required when status is shipped' });
      }
    }

    const order = await OrderModel.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const updated = await OrderModel.updateStatus(order.id, status, {
      trackingNumber,
      trackingCourier,
    });
    if (status === 'shipped' && updated && updated.tracking_number && updated.tracking_courier) {
      await notifyCustomerShippedOrder({ req, orderId: updated.id });
    }
    return res.json({ order: updated });
  } catch (err) {
    console.error('[adminUpdateOrderStatus]', err);
    return res.status(500).json({ message: 'Failed to update order status' });
  }
};


exports.adminReviewRefund = async (req, res) => {
  const action = String(req.body.action || '').toLowerCase();

  try {
    if (action === 'approve') {
      const order = await refundService.approveRefund({
        orderId: req.params.id,
        adminId: req.user.id,
      });
      await notifyCustomerRefund({
        req,
        orderId: order.id,
        status: 'refunded',
        claimColumn: 'customer_refund_result_email_sent_at',
      });
      return res.json({ order });
    }

    if (action === 'reject') {
      const order = await refundService.rejectRefund({
        orderId: req.params.id,
        adminId: req.user.id,
        reason: req.body.reason,
      });
      await notifyCustomerRefund({
        req,
        orderId: order.id,
        status: 'rejected',
        claimColumn: 'customer_refund_result_email_sent_at',
        reason: req.body.reason || extractRejectionReason(order),
      });
      return res.json({ order });
    }

    return res.status(400).json({ message: 'Refund action must be approve or reject' });
  } catch (err) {
    console.error('[adminReviewRefund]', err);
    return res.status(err.status || 500).json({
      message: err.status ? err.message : 'Failed to review refund',
      midtransResponse: err.midtransResponse,
      order: err.order,
    });
  }
};

exports.adminDeleteOrder = async (req, res) => {
  try {
    const deleted = await OrderModel.deleteById(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Order not found' });
    return res.json({ message: 'Order deleted.', order: deleted });
  } catch (err) {
    console.error('[adminDeleteOrder]', err);
    return res.status(500).json({ message: 'Failed to delete order' });
  }
};

// POST /orders/midtrans/notification  — legacy Midtrans webhook alias (public)
// Keep this export for backwards compatibility, but delegate to the canonical
// payment webhook so all payment status and inventory rules stay in one place.
exports.midtransNotification = async (req, res, next) => {
  const { handleNotification } = require('./paymentController');
  return handleNotification(req, res, next);
};
