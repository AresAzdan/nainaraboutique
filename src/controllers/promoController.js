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
    const {
      code, discount_pct, max_uses = 100, max_uses_per_user = 1,
      expires_at = null, applies_to_all = true,
      product_ids = [], product_id = null   // product_ids = array baru, product_id = legacy fallback
    } = req.body;

    if (!code) throw createError(400, 'Code is required.');
    if (!discount_pct || discount_pct < 1 || discount_pct > 100)
      throw createError(400, 'Discount must be between 1 and 100.');

    // Normalise: gabung product_ids & product_id (legacy), buang duplikat
    const ids = applies_to_all ? [] : [...new Set([
      ...(Array.isArray(product_ids) ? product_ids : []),
      ...(product_id ? [product_id] : [])
    ])].map(Number).filter(Boolean);

    const { rows } = await db.query(
      `INSERT INTO promo_codes
         (code, discount_pct, applies_to_all, product_id, product_ids, max_uses, max_uses_per_user, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        code.toUpperCase(), discount_pct, applies_to_all,
        ids[0] || null,   // product_id = first item (backward compat)
        ids,              // product_ids = full array
        max_uses, max_uses_per_user, expires_at
      ]
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
    const {
      discount_pct, max_uses, max_uses_per_user, expires_at,
      is_active, applies_to_all,
      product_ids, product_id   // terima keduanya
    } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (discount_pct !== undefined) {
      if (discount_pct < 1 || discount_pct > 100)
        throw createError(400, 'Discount must be between 1 and 100.');
      fields.push(`discount_pct = $${idx++}`); values.push(discount_pct);
    }
    if (max_uses !== undefined)          { fields.push(`max_uses = $${idx++}`);          values.push(max_uses); }
    if (max_uses_per_user !== undefined) { fields.push(`max_uses_per_user = $${idx++}`); values.push(max_uses_per_user); }
    if (expires_at !== undefined)        { fields.push(`expires_at = $${idx++}`);        values.push(expires_at || null); }
    if (is_active !== undefined)         { fields.push(`is_active = $${idx++}`);         values.push(is_active); }
    if (applies_to_all !== undefined)    { fields.push(`applies_to_all = $${idx++}`);    values.push(applies_to_all); }

    // Update product_ids array (dan sync product_id untuk backward compat)
    if (product_ids !== undefined || product_id !== undefined) {
      const resolvedAll = req.body.applies_to_all ?? true;
      const ids = resolvedAll ? [] : [...new Set([
        ...(Array.isArray(product_ids) ? product_ids : []),
        ...(product_id != null ? [product_id] : [])
      ])].map(Number).filter(Boolean);

      fields.push(`product_ids = $${idx++}`); values.push(ids);
      fields.push(`product_id = $${idx++}`);  values.push(ids[0] || null);
    }

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
    const { code, product_ids: cartProductIds = [] } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.json({ valid: false, message: 'Please log in to use a promo code.' });
    if (!code)   return res.json({ valid: false, message: 'Please enter a code.' });

    const { rows } = await db.query('SELECT * FROM promo_codes WHERE code = $1', [code.toUpperCase()]);
    const promo = rows[0];

    if (!promo)           return res.json({ valid: false, message: 'Invalid promo code.' });
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
    if (parseInt(userUsage.rows[0].count, 10) >= promo.max_uses_per_user)
      return res.json({ valid: false, message: `You can only use this code ${promo.max_uses_per_user} time(s).` });

    // Validasi product scope: kalau bukan applies_to_all, cek apakah ada irisan
    // antara produk di cart dengan produk yang diizinkan kupon ini
    if (!promo.applies_to_all) {
      const allowedIds = (promo.product_ids || []).map(Number);
      const cartIds    = (cartProductIds      || []).map(Number);
      const hasMatch   = cartIds.some(id => allowedIds.includes(id));
      if (!hasMatch) {
        const { rows: productRows } = await db.query(
          'SELECT name FROM products WHERE id = ANY($1)',
          [allowedIds]
        );
        const names = productRows.map(p => p.name).join(', ');
        return res.json({
          valid: false,
          message: `This code is only valid for: ${names}.`
        });
      }
    }

    res.json({
      valid: true,
      id: promo.id,
      code: promo.code,
      discount_pct: parseFloat(promo.discount_pct),
      applies_to_all: promo.applies_to_all,
      product_ids: promo.product_ids || [],
      product_id: promo.product_id    // backward compat
    });
  } catch (err) { next(err); }
};

const redeemPromoCode = async (promoId, userId) => {
  await db.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1', [promoId]);
  await db.query('INSERT INTO promo_code_uses (promo_id, user_id) VALUES ($1, $2)', [promoId, userId]);
};

module.exports = { getAllPromoCodes, createPromoCode, updatePromoCode, deletePromoCode, validatePromoCode, redeemPromoCode };
