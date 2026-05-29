const snap = require('../config/midtrans');
const OrderModel = require('../models/orderModel');
const db = require('../config/db');

// ─── Snap creation ────────────────────────────────────────────────────────────

const createPayment = async (req, res, next) => {
  try {
    const orderId = req.params.id;

    const order = await OrderModel.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ message: 'Order already processed' });
    }

    // Generate Midtrans order_id in NAINARA-{timestamp} format
    const midtransOrderId = `NAINARA-${Date.now()}`;

    // Save midtrans_order_id to DB so webhook can look it up later
    await db.query(
      'UPDATE orders SET midtrans_order_id = $1 WHERE id = $2',
      [midtransOrderId, order.id]
    );

    const parameter = {
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: parseInt(order.total_amount),
      },
      customer_details: {
        email: req.user.email,
      },
    };

    const transaction = await snap.createTransaction(parameter);

    res.json({ snap_token: transaction.token });

  } catch (err) {
    next(err);
  }
};

// ─── Status mapping ───────────────────────────────────────────────────────────

/**
 * Maps Midtrans transaction_status + fraud_status to our internal order status.
 * Returns null if no status change should be applied.
 *
 * @param {string} transactionStatus
 * @param {string|undefined} fraudStatus
 * @returns {string|null}
 */
const resolveOrderStatus = (transactionStatus, fraudStatus) => {
  switch (transactionStatus) {
    case 'settlement':
      return 'paid';

    case 'capture':
      // Midtrans documents capture as a successful card payment when fraud_status
      // is accept. Challenge/deny must not reduce stock or mark the order paid.
      return fraudStatus === 'accept' ? 'paid' : 'failed';

    case 'pending':
      return null; // never reduce stock or mark sold while the customer can still abandon payment

    case 'cancel':
      return 'cancelled';

    case 'expire':
      return 'expired';

    case 'deny':
    case 'failure':
      return 'failed';

    case 'refund':
    case 'partial_refund':
      return 'refunded';

    case 'chargeback':
    case 'partial_chargeback':
      return 'chargeback';

    default:
      return null; // unknown status — ignore safely
  }
};

const TERMINAL_STATUSES = [
  'paid',
  'cancelled',
  'expired',
  'failed',
  'refunded',
  'chargeback',
  'completed',
];

const FAILURE_STATUSES = ['cancelled', 'expired', 'failed'];

const getOrderItemsForUpdate = async (client, orderId) => {
  const { rows } = await client.query(
    `SELECT product_id, quantity
     FROM order_items
     WHERE order_id = $1
     ORDER BY product_id
     FOR UPDATE`,
    [orderId]
  );
  return rows;
};

const deductOrderStock = async (client, orderId) => {
  const items = await getOrderItemsForUpdate(client, orderId);

  for (const item of items) {
    const { rows } = await client.query(
      `UPDATE products
       SET stock = stock - $1
       WHERE id = $2 AND stock >= $1
       RETURNING id, stock`,
      [item.quantity, item.product_id]
    );

    if (!rows.length) {
      throw new Error(
        `Insufficient stock while settling order ${orderId} for product ${item.product_id}`
      );
    }
  }
};

const restoreOrderStock = async (client, orderId) => {
  const items = await getOrderItemsForUpdate(client, orderId);

  for (const item of items) {
    await client.query(
      `UPDATE products
       SET stock = stock + $1
       WHERE id = $2`,
      [item.quantity, item.product_id]
    );
  }
};

const updateOrderForPaymentStatus = async ({ client, orderId, targetStatus }) => {
  const { rows } = await client.query(
    `SELECT id, status, COALESCE(stock_deducted, false) AS stock_deducted
     FROM orders
     WHERE id = $1
     FOR UPDATE`,
    [orderId]
  );

  if (!rows.length) {
    return { action: 'missing' };
  }

  const order = rows[0];
  const previousStatus = order.status;
  const hadStockDeducted = order.stock_deducted;
  let stockAction = 'none';

  if (previousStatus === targetStatus && (targetStatus !== 'paid' || hadStockDeducted)) {
    return { action: 'noop', previousStatus, stockAction };
  }

  if (targetStatus === 'paid') {
    if (!hadStockDeducted) {
      await deductOrderStock(client, orderId);
      stockAction = 'deducted';
    }

    await client.query(
      `UPDATE orders
       SET status = $1, stock_deducted = true
       WHERE id = $2`,
      [targetStatus, orderId]
    );

    return { action: 'updated', previousStatus, targetStatus, stockAction };
  }

  if (FAILURE_STATUSES.includes(targetStatus) && hadStockDeducted) {
    await restoreOrderStock(client, orderId);
    stockAction = 'restored';
  }

  await client.query(
    `UPDATE orders
     SET status = $1,
         stock_deducted = CASE WHEN $3::boolean THEN false ELSE stock_deducted END
     WHERE id = $2`,
    [targetStatus, orderId, stockAction === 'restored']
  );

  return { action: 'updated', previousStatus, targetStatus, stockAction };
};

// ─── Webhook: POST /api/payments/notification ─────────────────────────────────
// Mount WITHOUT the authenticate middleware.
// Always returns HTTP 200 for verified non-actionable notifications. If a paid
// notification cannot be fulfilled because stock is unavailable, we return an
// error through Express so Midtrans retries and operators can investigate.

const handleNotification = async (req, res, next) => {
  try {
    console.log('[Webhook] Incoming notification body:', req.body);

    // 1. Delegate signature verification AND status parsing to the Midtrans client.
    //    snap.transaction.notification() calls GET /v2/{id}/status on the
    //    Midtrans API, verifies the payload authentically, and returns the
    //    normalised transaction object. Any signature mismatch or network
    //    error will throw, which we catch below.
    let notification;
    try {
      notification = await snap.transaction.notification(req.body);
    } catch (midtransErr) {
      console.error('[Webhook] Midtrans notification verification failed:', midtransErr.message);
      // Return 200 so Midtrans stops retrying an unrecoverable bad payload,
      // but log clearly so you can investigate.
      return res.status(200).json({ message: 'Notification rejected by Midtrans client.' });
    }

    const {
      order_id: rawOrderId,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
    } = notification;

    console.log(
      `[Webhook] Verified — order_id: ${rawOrderId}, ` +
      `status: ${transactionStatus}, fraud: ${fraudStatus}`
    );

    // 2. Validate format: must start with "NAINARA-"
    if (!rawOrderId || !rawOrderId.startsWith('NAINARA-')) {
      console.warn(`[Webhook] Unrecognised order_id format: ${rawOrderId}`);
      return res.status(200).json({ message: 'Unrecognised order_id format, ignored.' });
    }

    // 3. Resolve target status
    const targetStatus = resolveOrderStatus(transactionStatus, fraudStatus);

    if (targetStatus === null) {
      console.log(`[Webhook] No status change or stock movement for order_id ${rawOrderId} (${transactionStatus})`);
      return res.status(200).json({ message: 'No status change required.' });
    }

    // 4. Perform lookup, status update, and any inventory movement atomically.
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const lookupResult = await client.query(
        `SELECT id, status, COALESCE(stock_deducted, false) AS stock_deducted
         FROM orders
         WHERE midtrans_order_id = $1
         FOR UPDATE`,
        [rawOrderId]
      );

      if (!lookupResult.rows.length) {
        await client.query('ROLLBACK');
        console.warn(`[Webhook] No order found with midtrans_order_id: ${rawOrderId}`);
        return res.status(200).json({ message: 'Order not found, ignored.' });
      }

      const order = lookupResult.rows[0];

      if (
        TERMINAL_STATUSES.includes(order.status) &&
        order.status !== targetStatus &&
        !(FAILURE_STATUSES.includes(targetStatus) && order.stock_deducted)
      ) {
        await client.query('ROLLBACK');
        console.warn(
          `[Webhook] Order ${order.id} is in terminal status "${order.status}". ` +
          `Refusing transition to "${targetStatus}".`
        );
        return res.status(200).json({ message: 'Order already in terminal state, ignored.' });
      }

      const result = await updateOrderForPaymentStatus({ client, orderId: order.id, targetStatus });

      await client.query('COMMIT');

      console.log(
        `[Webhook] Order ${order.id}: ${result.previousStatus || order.status} → ${targetStatus}; ` +
        `stock action: ${result.stockAction || 'none'} (${transactionStatus})`
      );

      return res.status(200).json({
        message: `Order ${order.id} ${result.action}.`,
        status: targetStatus,
        stockAction: result.stockAction || 'none',
      });

    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('[Webhook] Unexpected error FULL:', err);
    console.error('[Webhook] Error message:', err.message);
    console.error('[Webhook] Error stack:', err.stack);
    next(err);
  }
};

module.exports = {
  createPayment,
  handleNotification,
  resolveOrderStatus,
};
