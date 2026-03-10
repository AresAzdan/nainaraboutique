const CategoryModel = require('../models/categoryModel');
const { createError } = require('../middleware/errorHandler');

// GET /api/categories
const getCategories = async (req, res, next) => {
  try {
    const categories = await CategoryModel.findAll();
    res.json(categories);
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/categories  [Admin only]
const createCategory = async (req, res, next) => {
  try {
    const { name } = req.body;
    const category = await CategoryModel.create(name);
    res.status(201).json({ message: 'Category created.', category });
  } catch (err) {
    next(err);
  }
};

// PUT /api/admin/categories/:id  [Admin only]
const updateCategory = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) throw createError(400, 'Name is required.');
    const category = await CategoryModel.update(req.params.id, name);
    if (!category) throw createError(404, 'Category not found.');
    res.json({ message: 'Category updated.', category });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/categories/:id  [Admin only]
const deleteCategory = async (req, res, next) => {
  try {
    const deleted = await CategoryModel.delete(req.params.id);
    if (!deleted) throw createError(404, 'Category not found.');
    res.json({ message: 'Category deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCategories, createCategory, updateCategory, deleteCategory };
