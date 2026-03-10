const db = require('../config/db');

const ReturnModel = {
  async create({ orderId, userId, orderItemId, reason, newSize, videoUrl }, client = db) {
    const { rows } = await client.query(
      `INSERT INTO return_requests (order_id, user_id, order_item_id, reason, new_size, video_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [orderId, userId, orderItemId, reason, newSize, videoUrl]
    );
    return rows[0];
  },

  async findById(id) {
    const { rows } = await db.query(
      `SELECT rr.*, oi.product_id, oi.quantity, oi.price,
              p.name AS product_name, p.image_url
       FROM return_requests rr
       JOIN order_items oi ON rr.order_item_id = oi.id
       JOIN products p ON oi.product_id = p.id
       WHERE rr.id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async findByOrderId(orderId) {
    const { rows } = await db.query(
      `SELECT rr.*, oi.product_id, oi.quantity, oi.price,
              p.name AS product_name, p.image_url
       FROM return_requests rr
       JOIN order_items oi ON rr.order_item_id = oi.id
       JOIN products p ON oi.product_id = p.id
       WHERE rr.order_id = $1
       ORDER BY rr.created_at DESC`,
      [orderId]
    );
    return rows;
  },

  async findByUserId(userId) {
    const { rows } = await db.query(
      `SELECT rr.*, oi.product_id, oi.quantity, oi.price,
              p.name AS product_name, p.image_url
       FROM return_requests rr
       JOIN order_items oi ON rr.order_item_id = oi.id
       JOIN products p ON oi.product_id = p.id
       WHERE rr.user_id = $1
       ORDER BY rr.created_at DESC`,
      [userId]
    );
    return rows;
  },

  async findAll({ page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const { rows } = await db.query(
      `SELECT rr.*, oi.product_id, oi.quantity, oi.price,
              p.name AS product_name, p.image_url,
              u.name AS user_name, u.email AS user_email
       FROM return_requests rr
       JOIN order_items oi ON rr.order_item_id = oi.id
       JOIN products p ON oi.product_id = p.id
       JOIN users u ON rr.user_id = u.id
       ORDER BY rr.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  },

  async updateStatus(id, status, adminNotes = null) {
    const { rows } = await db.query(
      `UPDATE return_requests SET status = $1, admin_notes = COALESCE($2, admin_notes)
       WHERE id = $3 RETURNING *`,
      [status, adminNotes, id]
    );
    return rows[0] || null;
  },

  async existsForOrderItem(orderItemId) {
    const { rows } = await db.query(
      `SELECT id FROM return_requests WHERE order_item_id = $1 LIMIT 1`,
      [orderItemId]
    );
    return rows.length > 0;
  },
};

module.exports = ReturnModel;
