const SizeGuideModel = require('../models/sizeGuideModel');
const { createError } = require('../middleware/errorHandler');

const normalizePayload = (body) => {
  const name = String(body.name || '').trim();
  const columns = Array.isArray(body.columns) ? body.columns.map(c => String(c).trim()).filter(Boolean) : [];
  const rows = Array.isArray(body.rows)
    ? body.rows.map(row => Array.isArray(row) ? row.map(cell => String(cell).trim()) : []).filter(row => row.length > 0)
    : [];

  if (!name) throw createError(400, 'Size guide name is required.');
  if (columns.length === 0) throw createError(400, 'Size guide must have at least one column.');
  if (rows.length === 0) throw createError(400, 'Size guide must have at least one row.');

  return { name, columns, rows };
};

const getSizeGuides = async (_req, res, next) => {
  try {
    res.json({ data: await SizeGuideModel.findAll() });
  } catch (err) {
    next(err);
  }
};

const createSizeGuide = async (req, res, next) => {
  try {
    const guide = await SizeGuideModel.create(normalizePayload(req.body));
    res.status(201).json({ message: 'Size guide created.', guide });
  } catch (err) {
    next(err);
  }
};

const updateSizeGuide = async (req, res, next) => {
  try {
    const guide = await SizeGuideModel.update(req.params.id, normalizePayload(req.body));
    if (!guide) throw createError(404, 'Size guide not found.');
    res.json({ message: 'Size guide updated.', guide });
  } catch (err) {
    next(err);
  }
};

const deleteSizeGuide = async (req, res, next) => {
  try {
    const deleted = await SizeGuideModel.delete(req.params.id);
    if (!deleted) throw createError(404, 'Size guide not found.');
    res.json({ message: 'Size guide deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getSizeGuides, createSizeGuide, updateSizeGuide, deleteSizeGuide };
