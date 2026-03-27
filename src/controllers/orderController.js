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
 * FIX 1 — Parse the numeric DB id from Midtrans order_id.
 * Midtrans sends:  "NAINARA-1774600791047"
 * DB orders.id is: integer  (e.g. 40)
 *
 * Strategy: the numeric suffix after the LAST '-' is the Unix-ms timestamp
 * used when the Snap token was created.  We stored that timestamp in
 * orders.midtrans_order_id (or we look up the order by that token).
 *
 * If you stored the full Midtrans order_id string in a column, use that.
 * Otherwise, look up by the raw midtrans_order_id string.
 */
async function resolveOrderId(midtransOrderId) {
  // First, try to find the order by the stored midtrans_order_id column.
  // This is the most reliable approach and survives any prefix change.
  const { rows } = await db.query(
    `SELECT id FROM orders WHERE midtrans_order_id = $1 LIMIT 1`,
    [midtransOrderId]
  );
  if (rows.length > 0) return rows[0].id;

  // Fallback: parse the numeric suffix.
  // "NAINARA-1774600791047" → 1774600791047
  // Then find the order whose created_at is nearest to that timestamp,
  // OR if you embed the DB id in the prefix differently, adjust here.
  // Common pattern: order_id = `${PREFIX}-${Date.now()}` stored at token-creation.
  // We look up by midtrans_order_id if the column exists; if not, parse suffix.
  const suffix = midtransOrderId.split('-').pop();
  const numericId = parseInt(suffix, 10);
  if (!isNaN(numericId)) return numericId;

  return null;
}

/**
 * Map Midtrans transaction_status → internal status string.
 * Reference: https://docs.midtrans.com/docs/transaction-status-flow
 */
function mapMidtransStatus(transactionStatus, fraudStatus) {
  switch (transactionStatus) {
    case 'capture':
      // Card payments: only mark paid when fraud check passes
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

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'No items provided' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // FIX 2 — snapshot product name at order creation time
    // so it is never lost even if the product is later deleted/renamed.
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
          // store whichever name column your products table uses
          product_name: product?.name || product?.title || item.product_name || null,
        };
      })
    );

    const totalAmount =
      enrichedItems.reduce((sum, i) => sum + i.price * i.quantity, 0) +
      shippingCost -
      discountAmount;

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
        first_name: recipientName || req.user.name,
        email: req.user.email,
        phone: phone || '',
      },
    });

    // Persist the Midtrans order_id so the webhook can look it up reliably
    await client.query(
      `UPDATE orders SET midtrans_order_id = $1 WHERE id = $2`,
      [midtransOrderId, order.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      order,
      snapToken: snapResponse.token,
      snapRedirectUrl: snapResponse.redirect_url,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[createOrder]', err);
    res.status(500).json({ message: 'Failed to create order', error: err.message });
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

    // FIX 2 — same product-name snapshot for guest orders
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
      shippingCost -
      discountAmount;

    const order = await OrderModel.create(
      {
        userId: null, // guest
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

    res.status(201).json({
      order,
      snapToken: snapResponse.token,
      snapRedirectUrl: snapResponse.redirect_url,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[createGuestOrder]', err);
    res.status(500).json({ message: 'Failed to create guest order', error: err.message });
  } finally {
    client.release();
  }
};

// GET /orders  — list authenticated user's orders
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await OrderModel.findByUserId(req.user.id);
    res.json({ orders });
  } catch (err) {
    console.error('[getMyOrders]', err);
    res.status(500).json({ message: 'Failed to fetch orders' });
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
    res.json({ order, items });
  } catch (err) {
    console.error('[getMyOrder]', err);
    res.status(500).json({ message: 'Failed to fetch order' });
  }
};

// GET /orders/guest/:id  — guest order lookup (no auth)
exports.getGuestOrder = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user_id !== null) {
      // Don't expose authenticated user orders via guest endpoint
      return res.status(403).json({ message: 'Forbidden' });
    }
    const items = await OrderModel.getOrderItems(order.id);
    res.json({ order, items });
  } catch (err) {
    console.error('[getGuestOrder]', err);
    res.status(500).json({ message: 'Failed to fetch guest order' });
  }
};

// PATCH /orders/:id/status  — user manually marks as paid (e.g. manual transfer)
exports.updateOrderStatus = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const updated = await OrderModel.updateStatus(order.id, req.body.status);
    res.json({ order: updated });
  } catch (err) {
    console.error('[updateOrderStatus]', err);
    res.status(500).json({ message: 'Failed to update status' });
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
      return res.status(400).json({ message: `Cannot cancel an order with status "${order.status}"` });
    }
    const updated = await OrderModel.updateStatus(order.id, 'cancelled');
    res.json({ order: updated });
  } catch (err) {
    console.error('[cancelOrder]', err);
    res.status(500).json({ message: 'Failed to cancel order' });
  }
};

// POST /orders/midtrans/notification  — Midtrans webhook (public)
exports.midtransNotification = async (req, res) => {
  try {
    // Verify the notification signature with Midtrans SDK
    // (throws if the hash doesn't match — rejects spoofed webhooks)
    const notification = await snap.transaction.notification(req.body);

    const {
      order_id: midtransOrderId,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
    } = notification;

    console.log('[midtransNotification] received:', { midtransOrderId, transactionStatus, fraudStatus });

    // ── FIX 1: resolve the numeric DB id from the Midtrans order_id string ──
    const dbOrderId = await resolveOrderId(midtransOrderId);
    if (!dbOrderId) {
      console.error('[midtransNotification] Could not resolve DB id for:', midtransOrderId);
      // Return 200 so Midtrans doesn't keep retrying a permanently unresolvable id
      return res.status(200).json({ message: 'Order not found, skipping' });
    }

    const newStatus = mapMidtransStatus(transactionStatus, fraudStatus);
    console.log(`[midtransNotification] Updating order #${dbOrderId} → "${newStatus}"`);

    const updated = await OrderModel.updateStatus(dbOrderId, newStatus);
    if (!updated) {
      console.warn('[midtransNotification] updateStatus returned null for id:', dbOrderId);
    }

    // Always return 200 — Midtrans retries on any non-2xx response
    res.status(200).json({ message: 'OK', orderId: dbOrderId, status: newStatus });
  } catch (err) {
    console.error('[midtransNotification] error:', err);
    // Still 200 to stop Midtrans retry loop for non-transient errors
    res.status(200).json({ message: 'Webhook processing error' });
  }
};
