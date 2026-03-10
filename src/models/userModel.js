const db = require('../config/db');

const UserModel = {
  async findByEmail(email) {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return rows[0] || null;
  },

  async findById(id) {
    const { rows } = await db.query(
      'SELECT id, name, email, phone, role, created_at FROM users WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  async findByIdWithPassword(id) {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  async create({ name, email, hashedPassword, role = 'user' }) {
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at`,
      [name, email, hashedPassword, role]
    );
    return rows[0];
  },

  async updateProfile(id, { name, phone }) {
    const { rows } = await db.query(
      `UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone)
       WHERE id = $3
       RETURNING id, name, email, phone, role, created_at`,
      [name, phone, id]
    );
    return rows[0] || null;
  },

  async updatePassword(id, hashedPassword) {
    const { rows } = await db.query(
      `UPDATE users SET password = $1 WHERE id = $2 RETURNING id`,
      [hashedPassword, id]
    );
    return rows[0] || null;
  },

  // ── ADDRESS METHODS ──────────────────────────────────────────

  async getAddresses(userId) {
    const { rows } = await db.query(
      `SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );
    return rows;
  },

  async createAddress(userId, {
    label = 'Home',
    recipient_name,
    phone,
    address,
    province_id,
    province_name,
    city_id,
    city_name,
    district_id,
    district_name,
    postal_code,
    is_default = false,
  }) {
    // If this is set as default, unset all others first
    if (is_default) {
      await db.query(
        'UPDATE user_addresses SET is_default = false WHERE user_id = $1',
        [userId]
      );
    }
    const { rows } = await db.query(
      `INSERT INTO user_addresses
         (user_id, label, recipient_name, phone, address,
          province_id, province_name, city_id, city_name,
          district_id, district_name, postal_code, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        userId, label, recipient_name, phone, address,
        province_id, province_name, city_id, city_name,
        district_id, district_name, postal_code, is_default,
      ]
    );
    return rows[0];
  },

  async deleteAddress(id, userId) {
    const { rowCount } = await db.query(
      'DELETE FROM user_addresses WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return rowCount > 0;
  },

  async setDefaultAddress(id, userId) {
    await db.query(
      'UPDATE user_addresses SET is_default = false WHERE user_id = $1',
      [userId]
    );
    const { rows } = await db.query(
      'UPDATE user_addresses SET is_default = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );
    return rows[0] || null;
  },
};

module.exports = UserModel;
