const db = require('../config/db');
const { createError } = require('../middleware/errorHandler');

// GET /api/admin/discounts
const getAllDiscounts = async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM discounts ORDER BY start_date DESC'
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/discounts
const createDiscount = async (req, res, next) => {
  try {
    const {
      name,
      discountPercent,   // frontend sends "discountPercent"
      percentage,        // fallback if sent as "percentage"
      startDate,
      endDate,
      startTime = '00:00:00',
      endTime   = '23:59:59',
    } = req.body;

    const pct = discountPercent ?? percentage;
    if (!name)              throw createError(400, 'Name is required.');
    if (!pct)               throw createError(400, 'Discount percentage is required.');
    if (!startDate)         throw createError(400, 'Start date is required.');
    if (!endDate)           throw createError(400, 'End date is required.');
    if (endDate < startDate) throw createError(400, 'End date must be >= start date.');

    const result = await db.query(
      `INSERT INTO discounts (name, percentage, start_date, end_date, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, pct, startDate, endDate, startTime, endTime]
    );

    res.status(201).json({ message: 'Discount created.', discount: result.rows[0] });
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
    } = req.body;

    const pct = discountPercent ?? percentage;

    // Build dynamic SET clause
    const fields = [];
    const values = [];
    let idx = 1;

    if (name)       { fields.push(`name = $${idx++}`);        values.push(name); }
    if (pct)        { fields.push(`percentage = $${idx++}`);  values.push(pct); }
    if (startDate)  { fields.push(`start_date = $${idx++}`);  values.push(startDate); }
    if (endDate)    { fields.push(`end_date = $${idx++}`);    values.push(endDate); }
    if (startTime)  { fields.push(`start_time = $${idx++}`);  values.push(startTime); }
    if (endTime)    { fields.push(`end_time = $${idx++}`);    values.push(endTime); }

    if (fields.length === 0) throw createError(400, 'No fields to update.');

    values.push(req.params.id);
    const result = await db.query(
      `UPDATE discounts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (!result.rows.length) throw createError(404, 'Discount not found.');
    res.json({ message: 'Discount updated.', discount: result.rows[0] });
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
