const db = require('../config/db');

const OrderModel = {
  async findAll({ page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const { rows } = await db.query(
      `SELECT o.*, u.name AS user_name, u.email AS user_email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  },

  async findByUserId(userId) {
    const { rows } = await db.query(
      `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  async findById(id) {
    const { rows } = await db.query(
      `SELECT o.*, u.name AS user_name, u.email AS user_email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async getOrderItems(orderId) {
    // FIX 2 — product name resolution priority:
    //   1. products.name   (live product name)
    //   2. products.title  (if your products table uses "title" instead of "name")
    //   3. oi.product_name (snapshot stored at order creation — never goes stale)
    //   4. Literal fallback 'Unknown Product'
    //
    // The snapshot column (oi.product_name) is the safety net: even if the
    // product is deleted or renamed after purchase, the original name is preserved.
    const { rows } = await db.query(
      `SELECT oi.*,
              COALESCE(
                NULLIF(TRIM(p.name),          ''),
                NULLIF(TRIM(oi.product_name), ''),
                'Unknown Product'
              ) AS product_name,
              p.image_url
       FROM order_items oi
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = $1`,
      [orderId]
    );
    return rows;
  },

  async create(
    {
      userId,
      totalAmount,
      items,
      shippingCost = 0,
      discountAmount = 0,
      promoCode = null,
      shippingAddress = null,
      shippingMethod = null,
      phone = null,
      recipientName = null,
      customerEmail = null,
    },
    client
  ) {
    // items = [{ product_id, quantity, price, product_name, size, color }]
    // items = [{ product_id, quantity, price, product_name, size }]
    const { rows } = await client.query(
      `INSERT INTO orders
         (user_id, total_amount, shipping_cost, discount_amount, promo_code,
          shipping_address, shipping_method, phone, recipient_name, customer_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        userId,
        totalAmount,
        shippingCost,
        discountAmount,
        promoCode,
        shippingAddress,
        shippingMethod,
        phone,
        recipientName,
        customerEmail,
      ]
    );
    const order = rows[0];

    for (const item of items) {
      // FIX 2 — write the product_name snapshot into order_items
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price, product_name, size, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          order.id,
          item.product_id,
          item.quantity,
          item.price,
          item.product_name || null,
          item.size || null,
          item.color || null,
        ]
      );
    }

    return order;
  },

  async updateStatus(id, status, options = {}) {
    const trackingNumber = options.trackingNumber ?? options.tracking_number ?? null;
    const trackingCourier = options.trackingCourier ?? options.tracking_courier ?? null;

    const { rows } = await db.query(
      `UPDATE orders
       SET status = $1,
           tracking_number = CASE WHEN $1 = 'shipped' THEN $3 ELSE tracking_number END,
           tracking_courier = CASE WHEN $1 = 'shipped' THEN $4 ELSE tracking_courier END,
           delivered_at = CASE
             WHEN $1 = 'completed' AND delivered_at IS NULL THEN NOW()
             ELSE delivered_at
           END
       WHERE id = $2
       RETURNING *`,
      [status, id, trackingNumber, trackingCourier]
    );
    return rows[0] || null;
  },

async deleteById(id) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const order = rows[0] || null;
      if (!order) {
        await client.query('ROLLBACK');
        return null;
      }

      // Delete dependent records explicitly so admin deletion works even when
      // production constraints were created without ON DELETE CASCADE.
      await client.query('DELETE FROM return_requests WHERE order_id = $1', [id]);
      await client.query('DELETE FROM order_items WHERE order_id = $1', [id]);
      await client.query('DELETE FROM orders WHERE id = $1', [id]);

      await client.query('COMMIT');
      return order;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

module.exports = OrderModel;
