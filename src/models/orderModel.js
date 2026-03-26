const db = require('../config/db');

const OrderModel = {
  async findAll({ page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const { rows } = await db.query(
      `SELECT o.*, u.name AS user_name, u.email AS user_email
       FROM orders o
       JOIN users u ON o.user_id = u.id
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
       JOIN users u ON o.user_id = u.id
       WHERE o.id = $1`,
      [orderid]
    );
    return rows[0] || null;
  },

  async getOrderItems(orderId) {
    const { rows } = await db.query(
      `SELECT oi.*, p.name AS product_name, p.image_url
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = $1`,
      [orderId]
    );
    return rows;
  },

  async create({ userId, totalAmount, items, shippingCost = 0, discountAmount = 0, promoCode = null, shippingAddress = null, shippingMethod = null, phone = null, recipientName = null }, client) {
    // items = [{ product_id, quantity, price }]
    const { rows } = await client.query(
      `INSERT INTO orders (user_id, total_amount, shipping_cost, discount_amount, promo_code, shipping_address, shipping_method, phone, recipient_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [userId, totalAmount, shippingCost, discountAmount, promoCode, shippingAddress, shippingMethod, phone, recipientName]
    );
    const order = rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, item.product_id, item.quantity, item.price]
      );
    }

    return order;
  },

  async updateStatus(id, status) {
    const { rows } = await db.query(
      `UPDATE orders SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return rows[0] || null;
  },
};

module.exports = OrderModel;
