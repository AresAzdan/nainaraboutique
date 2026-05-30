const midtransClient = require('midtrans-client');
const { applyResolvedStockDelta: buildResolvedStockDelta, resolveAvailableStock } = require('../utils/stockProtection');

const REFUND_STATUSES = Object.freeze({
  NONE: 'none',
  REQUESTED: 'requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PROCESSING: 'processing',
  REFUNDED: 'refunded',
  FAILED: 'failed',
});

const PAID_ORDER_STATUSES = new Set(['paid', 'settlement']);
const NON_REFUNDABLE_STATUSES = new Set([REFUND_STATUSES.PROCESSING, REFUND_STATUSES.REFUNDED]);

const getDefaultPool = () => require('../config/db');

const getCoreApi = () => new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const toNumber = (value) => Number(value || 0);

const normalizeErrorResponse = (err) => {
  if (!err) return { message: 'Unknown Midtrans refund error' };
  return {
    message: err.message || 'Midtrans refund failed',
    ApiResponse: err.ApiResponse || err.apiResponse || undefined,
    statusCode: err.httpStatusCode || err.statusCode || err.status || undefined,
  };
};

const recordRefundActivity = async (client, { actorId = null, action, description, orderId, metadata = {} }) => {
  await client.query(
    `INSERT INTO activity_logs
       (actor_id, action, description, type, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, 'refund', 'order', $4, $5::jsonb)`,
    [actorId, action, description, String(orderId), JSON.stringify(metadata || {})]
  );
};

const getOrderItemsForUpdate = async (client, orderId) => {
  const { rows } = await client.query(
    `SELECT product_id, quantity, size, color
     FROM order_items
     WHERE order_id = $1
     ORDER BY product_id
     FOR UPDATE`,
    [orderId]
  );
  return rows;
};

const getProductForStockUpdate = async (client, productId) => {
  const { rows } = await client.query(
    `SELECT id, name, stock, sizes, size_stocks, variant_stocks
     FROM products
     WHERE id = $1
     FOR UPDATE`,
    [productId]
  );
  return rows[0] || null;
};

const restoreOrderStockOnce = async (client, orderId) => {
  const { rows } = await client.query(
    `SELECT id, COALESCE(stock_deducted, false) AS stock_deducted
     FROM orders
     WHERE id = $1
     FOR UPDATE`,
    [orderId]
  );

  if (!rows.length || !rows[0].stock_deducted) return false;

  const items = await getOrderItemsForUpdate(client, orderId);
  for (const item of items) {
    const product = await getProductForStockUpdate(client, item.product_id);
    if (!product) continue;

    const quantity = Number(item.quantity);
    const resolvedStock = resolveAvailableStock(product, item.size, item.color);
    const stockDelta = buildResolvedStockDelta(product, item.size, item.color, resolvedStock.source, quantity);

    await client.query(
      `UPDATE products
       SET stock = stock + $1,
           size_stocks = CASE WHEN $4::boolean THEN $3::jsonb ELSE size_stocks END,
           variant_stocks = CASE WHEN $5::boolean THEN $3::jsonb ELSE variant_stocks END
       WHERE id = $2`,
      [quantity, item.product_id, JSON.stringify(stockDelta.stocks), stockDelta.updateSizeStocks, stockDelta.updateVariantStocks]
    );
  }

  await client.query(`UPDATE orders SET stock_deducted = false WHERE id = $1`, [orderId]);
  return true;
};

const validateRefundableOrder = (order, refundAmount) => {
  if (!order) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  const paymentStatus = order.payment_status || order.status;
  if (!PAID_ORDER_STATUSES.has(paymentStatus)) {
    const err = new Error('Only paid or settled orders can be refunded');
    err.status = 400;
    throw err;
  }

  if (!order.midtrans_order_id) {
    const err = new Error('Order is missing Midtrans order id');
    err.status = 400;
    throw err;
  }

  const refundStatus = order.refund_status || REFUND_STATUSES.NONE;
  if (NON_REFUNDABLE_STATUSES.has(refundStatus)) {
    const err = new Error(`Order refund is already ${refundStatus}`);
    err.status = 409;
    throw err;
  }

  const amount = toNumber(refundAmount || order.refund_amount || order.total_amount);
  const paidAmount = toNumber(order.total_amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > paidAmount) {
    const err = new Error('Refund amount must be greater than zero and less than or equal to paid amount');
    err.status = 400;
    throw err;
  }

  return amount;
};

const requestRefund = async ({ orderId, userId, reason, refundAmount = null, pool = getDefaultPool() }) => {
  if (!reason || !String(reason).trim()) {
    const err = new Error('Refund reason is required');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, user_id, status, status AS payment_status, total_amount, midtrans_order_id, refund_status, refund_amount
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId]
    );
    const order = rows[0] || null;

    if (!order) {
      const err = new Error('Order not found');
      err.status = 404;
      throw err;
    }

    if (Number(order.user_id) !== Number(userId)) {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }

    const currentStatus = order.refund_status || REFUND_STATUSES.NONE;
    if (currentStatus !== REFUND_STATUSES.NONE && currentStatus !== REFUND_STATUSES.FAILED && currentStatus !== REFUND_STATUSES.REJECTED) {
      const err = new Error(`Order refund is already ${currentStatus}`);
      err.status = 409;
      throw err;
    }

    const amount = validateRefundableOrder(order, refundAmount || order.total_amount);

    const updateResult = await client.query(
      `UPDATE orders
       SET refund_status = 'requested',
           refund_reason = $2,
           refund_amount = $3,
           refund_requested_at = NOW(),
           refund_approved_at = NULL,
           refunded_at = NULL,
           refund_midtrans_response = NULL,
           refund_by = NULL,
           customer_refund_requested_email_sent_at = NULL,
           customer_refund_result_email_sent_at = NULL,
           admin_refund_notified_at = NULL
       WHERE id = $1
         AND COALESCE(refund_status, 'none') NOT IN ('requested', 'approved', 'processing', 'refunded')
       RETURNING *`,
      [orderId, String(reason).trim(), amount]
    );

    if (!updateResult.rows.length) {
      const err = new Error('Refund request already exists');
      err.status = 409;
      throw err;
    }

    await client.query('COMMIT');
    return updateResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const rejectRefund = async ({ orderId, adminId, reason = null, pool = getDefaultPool() }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE orders
       SET refund_status = 'rejected',
           refund_by = $2,
           refund_approved_at = NULL,
           refund_midtrans_response = CASE WHEN $3::text IS NULL THEN refund_midtrans_response ELSE jsonb_build_object('rejection_reason', $3::text) END
       WHERE id = $1
         AND COALESCE(refund_status, 'none') IN ('requested', 'failed')
       RETURNING *`,
      [orderId, adminId, reason ? String(reason) : null]
    );

    if (!rows.length) {
      const err = new Error('Refund request not found or cannot be rejected');
      err.status = 409;
      throw err;
    }

    await recordRefundActivity(client, {
      actorId: adminId,
      action: 'refund_rejected',
      description: `Refund rejected for order #${orderId}`,
      orderId,
      metadata: { refundStatus: 'rejected' },
    });

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const approveRefund = async ({ orderId, adminId, pool = getDefaultPool(), coreApi = getCoreApi() }) => {
  let processingOrder;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status, status AS payment_status, total_amount, midtrans_order_id, refund_status, refund_amount
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId]
    );
    const order = rows[0] || null;
    const amount = validateRefundableOrder(order, order && (order.refund_amount || order.total_amount));

    if ((order.refund_status || REFUND_STATUSES.NONE) !== REFUND_STATUSES.REQUESTED &&
        (order.refund_status || REFUND_STATUSES.NONE) !== REFUND_STATUSES.FAILED) {
      const err = new Error('Order does not have a pending refund request');
      err.status = 409;
      throw err;
    }

    const updateResult = await client.query(
      `UPDATE orders
       SET refund_status = 'processing',
           refund_amount = $2,
           refund_by = $3,
           refund_approved_at = NOW()
       WHERE id = $1
         AND COALESCE(refund_status, 'none') IN ('requested', 'failed')
       RETURNING *`,
      [orderId, amount, adminId]
    );

    if (!updateResult.rows.length) {
      const err = new Error('Refund is already being processed');
      err.status = 409;
      throw err;
    }

    processingOrder = updateResult.rows[0];
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const refundPayload = {
    refund_key: `refund-${processingOrder.id}-${Date.now()}`,
    amount: Math.round(toNumber(processingOrder.refund_amount)),
    reason: processingOrder.refund_reason || 'Admin approved refund',
  };

  let midtransResponse;
  try {
    midtransResponse = await coreApi.transaction.refund(processingOrder.midtrans_order_id, refundPayload);
  } catch (err) {
    const errorResponse = normalizeErrorResponse(err);
    const failureClient = await pool.connect();
    let failedOrder = null;
    try {
      await failureClient.query('BEGIN');
      const { rows } = await failureClient.query(
        `UPDATE orders
         SET refund_status = 'failed',
             refund_midtrans_response = $2::jsonb
         WHERE id = $1
           AND refund_status = 'processing'
         RETURNING *`,
        [orderId, JSON.stringify(errorResponse)]
      );
      failedOrder = rows[0] || null;
      await failureClient.query('COMMIT');
    } catch (dbErr) {
      await failureClient.query('ROLLBACK');
      throw dbErr;
    } finally {
      failureClient.release();
    }

    const error = new Error('Midtrans refund failed');
    error.status = 502;
    error.order = failedOrder;
    error.midtransResponse = errorResponse;
    throw error;
  }

  const successClient = await pool.connect();
  try {
    await successClient.query('BEGIN');
    await restoreOrderStockOnce(successClient, orderId);
    const { rows } = await successClient.query(
      `UPDATE orders
       SET refund_status = 'refunded',
           status = 'refunded',
           refunded_at = NOW(),
           refund_midtrans_response = $2::jsonb
       WHERE id = $1
         AND refund_status = 'processing'
       RETURNING *`,
      [orderId, JSON.stringify(midtransResponse || {})]
    );

    if (!rows.length) {
      const err = new Error('Refund status changed while finalizing refund');
      err.status = 409;
      throw err;
    }

    await recordRefundActivity(successClient, {
      actorId: adminId,
      action: 'refund_approved',
      description: `Refund completed for order #${orderId}`,
      orderId,
      metadata: { refundStatus: 'refunded', refundAmount: processingOrder.refund_amount },
    });

    await successClient.query('COMMIT');
    return rows[0];
  } catch (err) {
    await successClient.query('ROLLBACK');
    throw err;
  } finally {
    successClient.release();
  }
};

module.exports = {
  REFUND_STATUSES,
  validateRefundableOrder,
  getDefaultPool,
  requestRefund,
  approveRefund,
  rejectRefund,
  restoreOrderStockOnce,
};
