const db = require('../config/db');

const SettingsModel = {
  async get(key) {
    const { rows } = await db.query(
      'SELECT value FROM site_settings WHERE key = $1',
      [key]
    );
    if (!rows[0]?.value) return null;
    try {
      return JSON.parse(rows[0].value);
    } catch {
      return rows[0].value;
    }
  },

  async set(key, value) {
    const { rows } = await db.query(
      `INSERT INTO site_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
       RETURNING *`,
      [key, JSON.stringify(value)]
    );
    return rows[0];
  },
};

module.exports = SettingsModel;
