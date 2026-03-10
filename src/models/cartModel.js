const db = require('../config/db');

const CartModel = {
  /** Get or create cart for user */
  async getOrCreate(userId) {
    let { rows } = await db.query('SELECT * FROM carts WHERE user_id = $1', [userId]);
    if (rows.length === 0) {
      const result = await db.query(
        'INSERT INTO carts (user_id) VALUES ($1) RETURNING *',
        [userId]
      );
      rows = result.rows;
    }
    return rows[0];
  },

  async getCartWithItems(userId) {
    const cart = await this.getOrCreate(userId);
    const { rows } = await db.query(
      `SELECT ci.id, ci.quantity,
              p.id AS product_id, p.name, p.price, p.image_url, p.stock
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1`,
      [cart.id]
    );
    return { cart_id: cart.id, items: rows };
  },

  async addOrUpdateItem(userId, productId, quantity) {
    const cart = await this.getOrCreate(userId);

    // Upsert: if item exists update quantity, otherwise insert
    const { rows } = await db.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
       RETURNING *`,
      [cart.id, productId, quantity]
    );
    return rows[0];
  },

  async updateItemQuantity(userId, productId, quantity) {
    const cart = await this.getOrCreate(userId);
    const { rows } = await db.query(
      `UPDATE cart_items SET quantity = $1
       WHERE cart_id = $2 AND product_id = $3
       RETURNING *`,
      [quantity, cart.id, productId]
    );
    return rows[0] || null;
  },

  async removeItem(userId, productId) {
    const cart = await this.getOrCreate(userId);
    const { rowCount } = await db.query(
      'DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2',
      [cart.id, productId]
    );
    return rowCount > 0;
  },

  async clearCart(cartId, client) {
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
  },
};

module.exports = CartModel;
