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
      // Only mark as paid if fraud check passed
      return fraudStatus === 'accept' ? 'paid' : 'failed';

    case 'pending':
      return null; // no change needed

    case 'cancel':
      return 'cancelled';

    case 'expire':
      return 'expired';

    case 'deny':
      return 'failed';

    default:
      return null; // unknown status — ignore safely
  }
};

// ─── Webhook: POST /api/payments/notification ─────────────────────────────────
// Mount WITHOUT the authenticate middleware.
// Always returns HTTP 200 after processing so Midtrans does not retry.

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
      console.log(`[Webhook] No status change needed for order_id ${rawOrderId} (${transactionStatus})`);
      return res.status(200).json({ message: 'No status change required.' });
    }

    // 4. Lookup order by midtrans_order_id column
    const lookupResult = await db.query(
      'SELECT id, status FROM orders WHERE midtrans_order_id = $1',
      [rawOrderId]
    );

    if (!lookupResult.rows.length) {
      console.warn(`[Webhook] No order found with midtrans_order_id: ${rawOrderId}`);
      return res.status(200).json({ message: 'Order not found, ignored.' });
    }

    const order = lookupResult.rows[0];
    const orderId = order.id;

    // 5. Idempotency guard — skip if already in target state or a terminal state
    const terminalStatuses = ['paid', 'cancelled', 'expired', 'failed', 'completed'];
    if (order.status === targetStatus) {
      console.log(`[Webhook] Order ${orderId} already has status "${targetStatus}", skipping.`);
      return res.status(200).json({ message: 'Already up to date.' });
    }
    if (terminalStatuses.includes(order.status)) {
      console.warn(
        `[Webhook] Order ${orderId} is in terminal status "${order.status}". ` +
        `Refusing transition to "${targetStatus}".`
      );
      return res.status(200).json({ message: 'Order already in terminal state, ignored.' });
    }

    // 6. Perform the status update inside a DB transaction for atomicity
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Re-fetch with FOR UPDATE to prevent races from concurrent notifications
      const locked = await client.query(
        'SELECT id, status FROM orders WHERE midtrans_order_id = $1 FOR UPDATE',
        [rawOrderId]
      );

      if (!locked.rows.length) {
        await client.query('ROLLBACK');
        return res.status(200).json({ message: 'Order not found under lock, ignored.' });
      }

      const currentStatus = locked.rows[0].status;

      // Double-check under the lock
      if (currentStatus === targetStatus || terminalStatuses.includes(currentStatus)) {
        await client.query('ROLLBACK');
        console.log(`[Webhook] Lock check: order ${orderId} status "${currentStatus}" unchanged.`);
        return res.status(200).json({ message: 'No update needed (race check).' });
      }

      await client.query(
        'UPDATE orders SET status = $1 WHERE id = $2',
        [targetStatus, orderId]
      );

      await client.query('COMMIT');

      console.log(
        `[Webhook] Order ${orderId}: "${currentStatus}" → "${targetStatus}" (${transactionStatus})`
      );

      return res.status(200).json({
        message: `Order ${orderId} status updated to "${targetStatus}".`,
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

module.exports = { createPayment, handleNotification };
