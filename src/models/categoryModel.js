const db = require('../config/db');

const CategoryModel = {
  async findAll() {
    const { rows } = await db.query('SELECT * FROM categories ORDER BY name');
    return rows;
  },

  async findById(id) {
    const { rows } = await db.query('SELECT * FROM categories WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async create(name) {
    const { rows } = await db.query(
      'INSERT INTO categories (name) VALUES ($1) RETURNING *',
      [name]
    );
    return rows[0];
  },

  async update(id, name) {
    const { rows } = await db.query(
      'UPDATE categories SET name = $1 WHERE id = $2 RETURNING *',
      [name, id]
    );
    return rows[0] || null;
  },

  async delete(id) {
    const { rowCount } = await db.query('DELETE FROM categories WHERE id = $1', [id]);
    return rowCount > 0;
  },
};

module.exports = CategoryModel;
