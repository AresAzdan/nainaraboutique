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
    default:
      return 'pending';
  }
}

// ─── SAFE MIDTRANS WRAPPER (ANTI STUCK) ───────────────────────────────────────

async function createSnapTransactionSafe(params) {
  return await Promise.race([
    snap.createTransaction(params),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Midtrans timeout')), 10000)
    ),
  ]);
}

// ─── Controllers ─────────────────────────────────────────────────────────────

// POST /orders
exports.createOrder = async (req, res) => {
  console.log('STEP 1: masuk createOrder');

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
          product_name:
            product?.name || product?.title || item.product_name || 'Product',
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

    console.log('STEP 2: sebelum midtrans');

    const midtransOrderId = `NAINARA-${Date.now()}`;

    const snapResponse = await createSnapTransactionSafe({
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

    console.log('STEP 3: dapet snap response');

    await client.query(
      `UPDATE orders SET midtrans_order_id = $1 WHERE id = $2`,
      [midtransOrderId, order.id]
    );

    await client.query('COMMIT');

    console.log('STEP 4: kirim response');

    return res.status(201).json({
      order,
      snapToken: snapResponse.token,
      snapRedirectUrl: snapResponse.redirect_url,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[createOrder ERROR]', err);

    return res.status(500).json({
      message: 'Failed to create order',
      error: err.message,
    });
  } finally {
    client.release();
  }
};

// ─── MIDTRANS WEBHOOK ─────────────────────────────────────────────────────────

exports.midtransNotification = async (req, res) => {
  try {
    const notification = await snap.transaction.notification(req.body);

    const {
      order_id: midtransOrderId,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
    } = notification;

    const dbOrderId = await resolveOrderId(midtransOrderId);

    if (!dbOrderId) {
      return res.status(200).json({ message: 'Order not found' });
    }

    const newStatus = mapMidtransStatus(transactionStatus, fraudStatus);

    await OrderModel.updateStatus(dbOrderId, newStatus);

    return res.status(200).json({ message: 'OK' });
  } catch (err) {
    console.error('[midtransNotification]', err);
    return res.status(200).json({ message: 'error' });
  }
};
