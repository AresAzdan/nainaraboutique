const midtransClient = require('midtrans-client');
const db = require('../config/db');
const OrderModel = require('../models/orderModel');

// ─── Midtrans snap client ────────────────────────────────────────────────────
const snap = new midtransClient.Snap({
  isProduction: process.env.NODE_ENV === 'production',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the numeric DB id from a Midtrans order_id string.
 * Strategy 1 (preferred): look up by midtrans_order_id column — set at token creation.
 * Strategy 2 (fallback): should never be needed if Strategy 1 is in place,
 *   but kept as a safety net using the timestamp suffix.
 */
async function resolveOrderId(midtransOrderId) {
  // Strategy 1: look up by the stored midtrans_order_id column (most reliable)
  const { rows } = await db.query(
    `SELECT id FROM orders WHERE midtrans_order_id = $1 LIMIT 1`,
    [midtransOrderId]
  );
  if (rows.length > 0) return rows[0].id;

  // Strategy 2: the suffix after the last '-' is a Unix-ms timestamp.
  // Find the order whose midtrans_order_id was set closest to that time.
  // NOTE: This is only a safety net — Strategy 1 should always match.
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

/**
 * Map Midtrans transaction_status → internal status string.
 * Reference: https://docs.midtrans.com/docs/transaction-status-flow
 */
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

// ─── Controllers ─────────────────────────────────────────────────────────────

// POST /orders  — authenticated, create order from cart
exports.createOrder = async (req, res) => {
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

  // FIX C — handle missing items gracefully instead of crashing
  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'No items provided' });
  }

  // FIX A — client declared inside the async function body (no stray closing brace above)
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const { rows } = await client.query(
          `SELECT name, title, price FROM products WHERE id = $1`,
          [item.product_id]
        );
        const product = rows[0];
        return {
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price ?? product?.price ?? 0,
          product_name: product?.name || product?.title || item.product_name || null,
        };
      })
    );

    const totalAmount =
      enrichedItems.reduce((sum, i) => sum + i.price * i.quantity, 0) +
      Number(shippingCost) -
      Number(discountAmount);

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

    // Generate Midtrans Snap token
    const midtransOrderId = `NAINARA-${Date.now()}`;
    const snapResponse = await snap.createTransaction({
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

    // Persist the Midtrans order_id so the webhook can look it up reliably
    await client.query(
      `UPDATE orders SET midtrans_order_id = $1 WHERE id = $2`,
      [midtransOrderId, order.id]
    );

    await client.query('COMMIT');

    // FIX B — always respond; never leave the request hanging
    return res.status(201).json({
      order,
      snapToken: snapResponse.token,
      snapRedirectUrl: snapResponse.redirect_url,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[createOrder]', err);
    return res.status(500).json({ message: 'Failed to create order', error: err.message });
  } finally {
    client.release();
  }
};

// POST /orders/guest  — no auth, guest checkout
exports.createGuestOrder = async (req, res) => {
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

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const { rows } = await client.query(
          `SELECT name, title, price FROM products WHERE id = $1`,
          [item.product_id]
        );
        const product = rows[0];
        return {
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price ?? product?.price ?? 0,
          product_name: product?.name || product?.title || item.product_name || null,
        };
      })
    );

    const totalAmount =
      enrichedItems.reduce((sum, i) => sum + i.price * i.quantity, 0) +
      Number(shippingCost) -
      Number(discountAmount);

    const order = await OrderModel.create(
      {
        userId: null,
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

    const midtransOrderId = `NAINARA-${Date.now()}`;
    const snapResponse = await snap.createTransaction({
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: Math.round(totalAmount),
      },
      customer_details: {
        first_name: recipientName || 'Guest',
        email: guestEmail || '',
        phone: phone || '',
      },
    });

    await client.query(
      `UPDATE orders SET midtrans_order_id = $1 WHERE id = $2`,
      [midtransOrderId, order.id]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      order,
      snapToken: snapResponse.token,
      snapRedirectUrl: snapResponse.redirect_url,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[createGuestOrder]', err);
    return res.status(500).json({ message: 'Failed to create guest order', error: err.message });
  } finally {
    client.release();
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
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
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
    if (order.user_id !== null) {
      return res.status(403).json({ message: 'Forbidden' });
    }
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
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
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
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (order.status !== 'pending') {
      return res.status(400).json({
        message: `Cannot cancel an order with status "${order.status}"`,
      });
    }
    const updated = await OrderModel.updateStatus(order.id, 'cancelled');
    return res.json({ order: updated });
  } catch (err) {
    console.error('[cancelOrder]', err);
    return res.status(500).json({ message: 'Failed to cancel order' });
  }
};

// ─── Admin controllers ────────────────────────────────────────────────────────

// GET /admin/orders
exports.getAllOrders = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM orders ORDER BY created_at DESC`
    );
    return res.json({ orders: rows });
  } catch (err) {
    console.error('[getAllOrders]', err);
    return res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

// GET /admin/orders/:id
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

// PUT /admin/orders/:id/status
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
    // Verify notification signature (throws if hash doesn't match)
    const notification = await snap.transaction.notification(req.body);

    const {
      order_id: midtransOrderId,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
    } = notification;

    console.log('[midtransNotification] received:', {
      midtransOrderId,
      transactionStatus,
      fraudStatus,
    });

    // FIX D — resolve the real DB row id from the Midtrans order_id string
    const dbOrderId = await resolveOrderId(midtransOrderId);
    if (!dbOrderId) {
      console.error('[midtransNotification] Could not resolve DB id for:', midtransOrderId);
      // Return 200 so Midtrans stops retrying a permanently unresolvable id
      return res.status(200).json({ message: 'Order not found, skipping' });
    }

    const newStatus = mapMidtransStatus(transactionStatus, fraudStatus);
    console.log(`[midtransNotification] Updating order #${dbOrderId} → "${newStatus}"`);

    const updated = await OrderModel.updateStatus(dbOrderId, newStatus);
    if (!updated) {
      console.warn('[midtransNotification] updateStatus returned null for id:', dbOrderId);
    }

    // Always return 200 — Midtrans retries on any non-2xx
    return res.status(200).json({ message: 'OK', orderId: dbOrderId, status: newStatus });
  } catch (err) {
    console.error('[midtransNotification] error:', err);
    return res.status(200).json({ message: 'Webhook processing error' });
  }
};
