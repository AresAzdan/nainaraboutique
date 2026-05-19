const db = require('../config/db');
const { createError } = require('../middleware/errorHandler');

// GET /api/admin/promo-codes  [Admin]
const getAllPromoCodes = async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM promo_codes ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { next(err); }
};

// POST /api/admin/promo-codes  [Admin]
const createPromoCode = async (req, res, next) => {
  try {
    const { code, discount_pct, max_uses = 100, max_uses_per_user = 1, expires_at = null, applies_to_all = true, product_id = null } = req.body;
    if (!code) throw createError(400, 'Code is required.');
    if (!discount_pct || discount_pct < 1 || discount_pct > 100)
      throw createError(400, 'Discount must be between 1 and 100.');
    const { rows } = await db.query(
      `INSERT INTO promo_codes (code, discount_pct, applies_to_all, product_id, max_uses, max_uses_per_user, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [code.toUpperCase(), discount_pct, applies_to_all, applies_to_all ? null : product_id, max_uses, max_uses_per_user, expires_at]
    );
    res.status(201).json({ message: 'Promo code created.', promo: rows[0] });
  } catch (err) {
    if (err.code === '23505') return next(createError(409, 'Code already exists.'));
    next(err);
  }
};

// PUT /api/admin/promo-codes/:id  [Admin]
const updatePromoCode = async (req, res, next) => {
  try {
    const { discount_pct, max_uses, max_uses_per_user, expires_at, is_active, applies_to_all, product_id } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (discount_pct !== undefined) {
      if (discount_pct < 1 || discount_pct > 100)
        throw createError(400, 'Discount must be between 1 and 100.');
      fields.push(`discount_pct = $${idx++}`); values.push(discount_pct);
    }
    if (max_uses !== undefined)           { fields.push(`max_uses = $${idx++}`);           values.push(max_uses); }
    if (max_uses_per_user !== undefined)  { fields.push(`max_uses_per_user = $${idx++}`);  values.push(max_uses_per_user); }
    if (expires_at !== undefined)         { fields.push(`expires_at = $${idx++}`);         values.push(expires_at || null); }
    if (is_active !== undefined)          { fields.push(`is_active = $${idx++}`);          values.push(is_active); }
    if (applies_to_all !== undefined)     { fields.push(`applies_to_all = $${idx++}`);     values.push(applies_to_all); }
    if (product_id !== undefined)         { fields.push(`product_id = $${idx++}`);         values.push(product_id); }

    if (fields.length === 0) throw createError(400, 'No fields to update.');

    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE promo_codes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows.length) throw createError(404, 'Promo code not found.');
    res.json({ message: 'Promo code updated.', promo: rows[0] });
  } catch (err) { next(err); }
};

// DELETE /api/admin/promo-codes/:id  [Admin]
const deletePromoCode = async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM promo_codes WHERE id = $1', [req.params.id]);
    if (!rowCount) throw createError(404, 'Promo code not found.');
    res.json({ message: 'Promo code deleted.' });
  } catch (err) { next(err); }
};

// POST /api/promo-codes/validate  [Protected — requires login]
const validatePromoCode = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.json({ valid: false, message: 'Please log in to use a promo code.' });
    if (!code) return res.json({ valid: false, message: 'Please enter a code.' });

    const { rows } = await db.query('SELECT * FROM promo_codes WHERE code = $1', [code.toUpperCase()]);
    const promo = rows[0];

    if (!promo) return res.json({ valid: false, message: 'Invalid promo code.' });
    if (!promo.is_active) return res.json({ valid: false, message: 'This promo code is inactive.' });

    const today = new Date().toISOString().split('T')[0];
    if (promo.expires_at && promo.expires_at.toISOString().split('T')[0] < today)
      return res.json({ valid: false, message: 'This promo code has expired.' });

    if (promo.used_count >= promo.max_uses)
      return res.json({ valid: false, message: 'This promo code has reached its maximum uses.' });

    const userUsage = await db.query(
      'SELECT COUNT(*) FROM promo_code_uses WHERE promo_id = $1 AND user_id = $2',
      [promo.id, userId]
    );
    const userUseCount = parseInt(userUsage.rows[0].count, 10);
    if (userUseCount >= promo.max_uses_per_user)
      return res.json({ valid: false, message: `You can only use this code ${promo.max_uses_per_user} time(s).` });

    res.json({
      valid: true,
      id: promo.id,
      code: promo.code,
      discount_pct: parseFloat(promo.discount_pct),
      applies_to_all: promo.applies_to_all,
      product_id: promo.product_id
    });
  } catch (err) { next(err); }
};

const redeemPromoCode = async (promoId, userId) => {
  await db.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1', [promoId]);
  await db.query('INSERT INTO promo_code_uses (promo_id, user_id) VALUES ($1, $2)', [promoId, userId]);
};

module.exports = { getAllPromoCodes, createPromoCode, updatePromoCode, deletePromoCode, validatePromoCode, redeemPromoCode };
