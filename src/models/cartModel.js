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
      `SELECT ci.id, ci.quantity, ci.size, ci.color,
              p.id AS product_id, p.name, p.price, p.image_url, p.stock, p.size_stocks, p.variant_stocks
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1`,
      [cart.id]
    );
    return { cart_id: cart.id, items: rows };
  },

  async getItemQuantity(userId, productId, size = null, color = null) {
    const cart = await this.getOrCreate(userId);
    const { rows } = await db.query(
      `SELECT quantity FROM cart_items
       WHERE cart_id = $1
         AND product_id = $2
         AND size IS NOT DISTINCT FROM $3
         AND color IS NOT DISTINCT FROM $4`,
      [cart.id, productId, size, color]
    );
    return Number(rows[0]?.quantity || 0);
  },

  async addOrUpdateItem(userId, productId, quantity, size = null, color = null) {
    const cart = await this.getOrCreate(userId);

    const existing = await db.query(
      `SELECT id, quantity FROM cart_items
       WHERE cart_id = $1
         AND product_id = $2
         AND size IS NOT DISTINCT FROM $3
         AND color IS NOT DISTINCT FROM $4`,
      [cart.id, productId, size, color]
    );

    if (existing.rows[0]) {
      const { rows } = await db.query(
        `UPDATE cart_items
         SET quantity = quantity + $1
         WHERE id = $2
         RETURNING *`,
        [quantity, existing.rows[0].id]
      );
      return rows[0];
    }

    const { rows } = await db.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity, size, color)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [cart.id, productId, quantity, size, color]
    );
    return rows[0];
  },

  async updateItemQuantity(userId, productId, quantity, size = null, color = null) {
    const cart = await this.getOrCreate(userId);
    const { rows } = await db.query(
      `UPDATE cart_items SET quantity = $1
       WHERE cart_id = $2
         AND product_id = $3
         AND size IS NOT DISTINCT FROM $4
         AND color IS NOT DISTINCT FROM $5
       RETURNING *`,
      [quantity, cart.id, productId, size, color]
    );
    return rows[0] || null;
  },

  async removeItem(userId, productId, size = null, color = null) {
    const cart = await this.getOrCreate(userId);
    const { rowCount } = await db.query(
      `DELETE FROM cart_items
       WHERE cart_id = $1
         AND product_id = $2
         AND ($3::varchar IS NULL OR size IS NOT DISTINCT FROM $3)
         AND ($4::varchar IS NULL OR color IS NOT DISTINCT FROM $4)`,
      [cart.id, productId, size, color]
    );
    return rowCount > 0;
  },

  async clearCart(cartId, client) {
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
  },
};

module.exports = CartModel;
