const router = require('express').Router();
const { getProducts, getProduct } = require('../controllers/productController');

// GET /api/products
router.get('/', getProducts);

// GET /api/products/:id
router.get('/:id', getProduct);

module.exports = router;
