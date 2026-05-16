const db = require('../config/db');

const normalizeGuide = (row) => row ? ({
  id: row.id,
  name: row.name,
  columns: Array.isArray(row.columns) ? row.columns : [],
  rows: Array.isArray(row.rows) ? row.rows : [],
  created_at: row.created_at,
  updated_at: row.updated_at,
}) : null;

const SizeGuideModel = {
  async findAll() {
    const { rows } = await db.query(
      `SELECT id, name, columns, rows, created_at, updated_at
       FROM size_guides
       ORDER BY name ASC`
    );
    return rows.map(normalizeGuide);
  },

  async findById(id) {
    const { rows } = await db.query(
      `SELECT id, name, columns, rows, created_at, updated_at
       FROM size_guides
       WHERE id = $1`,
      [id]
    );
    return normalizeGuide(rows[0]);
  },

  async create({ name, columns = [], rows = [] }) {
    const { rows: result } = await db.query(
      `INSERT INTO size_guides (name, columns, rows)
       VALUES ($1, $2, $3)
       RETURNING id, name, columns, rows, created_at, updated_at`,
      [name, JSON.stringify(columns), JSON.stringify(rows)]
    );
    return normalizeGuide(result[0]);
  },

  async update(id, { name, columns = [], rows = [] }) {
    const { rows: result } = await db.query(
      `UPDATE size_guides
       SET name = $1, columns = $2, rows = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, columns, rows, created_at, updated_at`,
      [name, JSON.stringify(columns), JSON.stringify(rows), id]
    );
    return normalizeGuide(result[0]);
  },

  async delete(id) {
    const { rowCount } = await db.query('DELETE FROM size_guides WHERE id = $1', [id]);
    return rowCount > 0;
  },
};

module.exports = SizeGuideModel;
