const router = require('express').Router();
const {
  getAllDiscounts,
  createDiscount,
  updateDiscount,
  deleteDiscount,
} = require('../controllers/discountController');

// GET    /api/admin/discounts
router.get('/',    getAllDiscounts);

// POST   /api/admin/discounts
router.post('/',   createDiscount);

// PUT    /api/admin/discounts/:id
router.put('/:id', updateDiscount);

// DELETE /api/admin/discounts/:id
router.delete('/:id', deleteDiscount);

module.exports = router;
