const snap = require('../config/midtrans');
const OrderModel = require('../models/orderModel');
const db = require('../config/db');
const { normalizeSizeStocks, normalizeVariantStocks, parseColorToken, resolveAvailableStock, validateOrderStock } = require('../utils/stockProtection');

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

    const orderItems = await OrderModel.getOrderItems(order.id);
    await validateOrderStock(orderItems, db);

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
    `SELECT id, name, stock, size_stocks, variant_stocks
     FROM products
     WHERE id = $1
     FOR UPDATE`,
    [productId]
  );
  return rows[0] || null;
};

const applyNestedStockDelta = (stocks, outerKey, innerKey, delta) => {
  const currentOuter = stocks[outerKey];
  if (!currentOuter || typeof currentOuter !== 'object' || Array.isArray(currentOuter)) return stocks;
  if (!Object.prototype.hasOwnProperty.call(currentOuter, innerKey)) return stocks;

  const current = Number(currentOuter[innerKey]) || 0;
  const next = current + delta;
  if (next < 0) throw new Error(`Insufficient stock for ${outerKey} / ${innerKey}`);

  return { ...stocks, [outerKey]: { ...currentOuter, [innerKey]: next } };
};

const applyFlatStockDelta = (stocks, key, delta) => {
  if (!Object.prototype.hasOwnProperty.call(stocks, key)) return stocks;
  const current = Number(stocks[key]) || 0;
  const next = current + delta;
  if (next < 0) throw new Error(`Insufficient stock for ${key}`);
  return { ...stocks, [key]: next };
};

const applyVariantStockDelta = (product, size, color, delta) => {
  const sizeKey = size || null;
  const sizeKeys = [...new Set([sizeKey, 'default'].filter(Boolean))];
  const variantStocks = normalizeVariantStocks(product.variant_stocks);
  const parsed = parseColorToken(color);
  const colorKeys = [...new Set([parsed.raw, parsed.name].filter(Boolean))];

  for (const colorKey of colorKeys) {
    for (const key of sizeKeys) {
      const nextVariantStocks = applyNestedStockDelta(variantStocks, colorKey, key, delta);
      if (nextVariantStocks !== variantStocks) return nextVariantStocks;
    }
  }

  for (const colorKey of colorKeys) {
    for (const key of sizeKeys) {
      const nextVariantStocks = applyFlatStockDelta(variantStocks, `${colorKey}::${key}`, delta);
      if (nextVariantStocks !== variantStocks) return nextVariantStocks;
    }
  }

  for (const colorKey of colorKeys) {
    if (!sizeKey) {
      const nextVariantStocks = applyFlatStockDelta(variantStocks, colorKey, delta);
      if (nextVariantStocks !== variantStocks) return nextVariantStocks;
    }
  }

  return variantStocks;
};

const applySizeStockDelta = (product, size, delta) => {
  const sizeKey = size || 'default';
  const sizeStocks = normalizeSizeStocks(product.size_stocks);
  return applyFlatStockDelta(sizeStocks, sizeKey, delta);
};

const applyResolvedStockDelta = (product, size, color, source, delta) => {
  if (source === 'variant') {
    return { stocks: applyVariantStockDelta(product, size, color, delta), updateVariantStocks: true, updateSizeStocks: false };
  }
  if (source === 'size') {
    return { stocks: applySizeStockDelta(product, size, delta), updateVariantStocks: false, updateSizeStocks: true };
  }
  return { stocks: {}, updateVariantStocks: false, updateSizeStocks: false };
};

const deductOrderStock = async (client, orderId) => {
  const items = await getOrderItemsForUpdate(client, orderId);

  for (const item of items) {
    const product = await getProductForStockUpdate(client, item.product_id);
    if (!product) throw new Error(`Product ${item.product_id} not found while settling order ${orderId}`);

    const quantity = Number(item.quantity);
    const productStock = Number(product.stock) || 0;
    const resolvedStock = resolveAvailableStock(product, item.size, item.color);

    if (productStock < quantity || resolvedStock.available < quantity) {
      throw new Error(
        `Insufficient stock while settling order ${orderId} for product ${item.product_id}`
      );
    }

    const stockDelta = applyResolvedStockDelta(product, item.size, item.color, resolvedStock.source, -quantity);
    const { rows } = await client.query(
      `UPDATE products
       SET stock = stock - $1,
           size_stocks = CASE WHEN $4::boolean THEN $3::jsonb ELSE size_stocks END,
           variant_stocks = CASE WHEN $5::boolean THEN $3::jsonb ELSE variant_stocks END
       WHERE id = $2 AND stock >= $1
       RETURNING id, stock`,
      [quantity, item.product_id, JSON.stringify(stockDelta.stocks), stockDelta.updateSizeStocks, stockDelta.updateVariantStocks]
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
    const product = await getProductForStockUpdate(client, item.product_id);
    if (!product) continue;

    const quantity = Number(item.quantity);
    const resolvedStock = resolveAvailableStock(product, item.size, item.color);
    const stockDelta = applyResolvedStockDelta(product, item.size, item.color, resolvedStock.source, quantity);

    await client.query(
      `UPDATE products
       SET stock = stock + $1,
           size_stocks = CASE WHEN $4::boolean THEN $3::jsonb ELSE size_stocks END,
           variant_stocks = CASE WHEN $5::boolean THEN $3::jsonb ELSE variant_stocks END
       WHERE id = $2`,
      [quantity, item.product_id, JSON.stringify(stockDelta.stocks), stockDelta.updateSizeStocks, stockDelta.updateVariantStocks]
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
