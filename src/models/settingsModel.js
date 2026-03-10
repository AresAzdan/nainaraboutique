const db = require('../config/db');

const SettingsModel = {
  async get(key) {
    const { rows } = await db.query(
      'SELECT value FROM site_settings WHERE key = $1',
      [key]
    );
    return rows[0]?.value || null;
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
