const db = require('../config/db');
const { createError } = require('../middleware/errorHandler');

// GET /api/admin/discounts
const getAllDiscounts = async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM discounts ORDER BY start_date DESC');
    const discounts = result.rows;

    // Attach productIds to each discount
    const dpResult = await db.query('SELECT discount_id, product_id FROM discount_products');
    const dpMap = {};
    for (const row of dpResult.rows) {
      if (!dpMap[row.discount_id]) dpMap[row.discount_id] = [];
      dpMap[row.discount_id].push(row.product_id);
    }

    const enriched = discounts.map(d => ({
      ...d,
      discountPercent: parseFloat(d.percentage),
      startDate: d.start_date,
      endDate:   d.end_date,
      startTime: d.start_time,
      endTime:   d.end_time,
      productIds: dpMap[d.id] || [],
    }));

    res.json(enriched);
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/discounts
const createDiscount = async (req, res, next) => {
  try {
    const {
      name,
      discountPercent,
      percentage,
      startDate,
      endDate,
      startTime = '00:00:00',
      endTime   = '23:59:59',
      productIds = [],
    } = req.body;

    const pct = discountPercent ?? percentage;
    if (!name)               throw createError(400, 'Name is required.');
    if (!pct)                throw createError(400, 'Discount percentage is required.');
    if (Number(pct) <= 0 || Number(pct) > 100)
      throw createError(400, 'Discount percentage must be between 1 and 100.');
    if (!startDate)          throw createError(400, 'Start date is required.');
    if (!endDate)            throw createError(400, 'End date is required.');
    if (endDate < startDate) throw createError(400, 'End date must be >= start date.');

    const normalizedProductIds = Array.isArray(productIds)
      ? [...new Set(productIds.map(Number).filter(Boolean))]
      : [];

    const result = await db.query(
      `INSERT INTO discounts (name, percentage, start_date, end_date, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, pct, startDate, endDate, startTime, endTime]
    );
    const discount = result.rows[0];

    // Save product associations into discount_products
    if (normalizedProductIds.length > 0) {
      for (const productId of normalizedProductIds) {
        await db.query(
          'INSERT INTO discount_products (discount_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [discount.id, productId]
        );
      }
    }

    res.status(201).json({
      message: 'Discount created.',
      discount: {
        ...discount,
        discountPercent: parseFloat(discount.percentage),
        startDate:  discount.start_date,
        endDate:    discount.end_date,
        startTime:  discount.start_time,
        endTime:    discount.end_time,
        productIds: normalizedProductIds,
      }
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/admin/discounts/:id
const updateDiscount = async (req, res, next) => {
  try {
    const {
      name,
      discountPercent,
      percentage,
      startDate,
      endDate,
      startTime,
      endTime,
      productIds,
    } = req.body;

    const pct = discountPercent ?? percentage;
    if (pct !== undefined && (Number(pct) <= 0 || Number(pct) > 100)) {
      throw createError(400, 'Discount percentage must be between 1 and 100.');
    }
    if (startDate && endDate && endDate < startDate) {
      throw createError(400, 'End date must be >= start date.');
    }

    const existing = await db.query('SELECT * FROM discounts WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) throw createError(404, 'Discount not found.');

    const formatDate = (value) => value instanceof Date ? value.toISOString().split('T')[0] : value;
    const effectiveStartDate = startDate || formatDate(existing.rows[0].start_date);
    const effectiveEndDate = endDate || formatDate(existing.rows[0].end_date);
    if (effectiveEndDate < effectiveStartDate) {
      throw createError(400, 'End date must be >= start date.');
    }

    // Build dynamic SET clause. Product mappings are handled separately below,
    // so editing only the applied products is a valid update.
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined)      { fields.push(`name = $${idx++}`);        values.push(name); }
    if (pct !== undefined)       { fields.push(`percentage = $${idx++}`);  values.push(pct); }
    if (startDate !== undefined) { fields.push(`start_date = $${idx++}`);  values.push(startDate); }
    if (endDate !== undefined)   { fields.push(`end_date = $${idx++}`);    values.push(endDate); }
    if (startTime !== undefined) { fields.push(`start_time = $${idx++}`);  values.push(startTime); }
    if (endTime !== undefined)   { fields.push(`end_time = $${idx++}`);    values.push(endTime); }

    let updated = existing.rows[0];
    if (fields.length > 0) {
      values.push(req.params.id);
      const result = await db.query(
        `UPDATE discounts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      updated = result.rows[0];
    } else if (!Array.isArray(productIds)) {
      throw createError(400, 'No fields to update.');
    }

    // Update productIds if provided.
    if (Array.isArray(productIds)) {
      await db.query('DELETE FROM discount_products WHERE discount_id = $1', [updated.id]);
      for (const productId of [...new Set(productIds.map(Number).filter(Boolean))]) {
        await db.query(
          'INSERT INTO discount_products (discount_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [updated.id, productId]
        );
      }
    }
    const currentProductIds = Array.isArray(productIds)
      ? [...new Set(productIds.map(Number).filter(Boolean))]
      : (await db.query('SELECT product_id FROM discount_products WHERE discount_id = $1', [updated.id])).rows.map(r => r.product_id);

    res.json({
      message: 'Discount updated.',
      discount: {
        ...updated,
        discountPercent: parseFloat(updated.percentage),
        startDate:  updated.start_date,
        endDate:    updated.end_date,
        startTime:  updated.start_time,
        endTime:    updated.end_time,
        productIds: currentProductIds,
      }
    });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/discounts/:id
const deleteDiscount = async (req, res, next) => {
  try {
    const result = await db.query(
      'DELETE FROM discounts WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rows.length) throw createError(404, 'Discount not found.');
    res.json({ message: 'Discount deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllDiscounts, createDiscount, updateDiscount, deleteDiscount };
