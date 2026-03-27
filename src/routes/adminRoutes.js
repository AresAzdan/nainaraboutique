const router = require('express').Router();
const { authenticate, authorizeAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');

const { getAllReturns, reviewReturn } = require('../controllers/returnController');
const { createProduct, updateProduct, deleteProduct } = require('../controllers/productController');
const { createCategory, updateCategory, deleteCategory } = require('../controllers/categoryController');

// FIX E — import all three admin order handlers from orderController
// These are now properly defined and exported so this import will not throw
const { getAllOrders, adminGetOrder, adminUpdateOrderStatus } = require('../controllers/orderController');

const { getAllDiscounts, createDiscount, updateDiscount, deleteDiscount } = require('../controllers/discountController');
const { getAllCustomers, getCustomer } = require('../controllers/customerController');
const { getAllPromoCodes, createPromoCode, deletePromoCode } = require('../controllers/promoController');
const { uploadImages } = require('../controllers/uploadController');
const { updateHomepage } = require('../controllers/settingsController');

// All admin routes require authentication + admin role
router.use(authenticate, authorizeAdmin);

// ── Returns ───────────────────────────────────
router.get('/returns', getAllReturns);
router.patch('/returns/:id', reviewReturn);

// ── Homepage Settings ─────────────────────────
router.put('/homepage', updateHomepage);

// ── Upload ────────────────────────────────────
router.post('/upload', ...uploadImages);

// ── Products ──────────────────────────────────
router.post('/products',       validate(['name', 'price']), createProduct);
router.put('/products/:id',    updateProduct);
router.delete('/products/:id', deleteProduct);

// ── Categories ────────────────────────────────
router.post('/categories',       validate(['name']), createCategory);
router.put('/categories/:id',    updateCategory);
router.delete('/categories/:id', deleteCategory);

// ── Orders (re-enabled — handlers now exist) ──
router.get('/orders',              getAllOrders);
router.get('/orders/:id',          adminGetOrder);
router.put('/orders/:id/status',   validate(['status']), adminUpdateOrderStatus);

// ── Discounts ─────────────────────────────────
router.get('/discounts',         getAllDiscounts);
router.post('/discounts',        createDiscount);
router.put('/discounts/:id',     updateDiscount);
router.delete('/discounts/:id',  deleteDiscount);

// ── Customers ─────────────────────────────────
router.get('/customers',     getAllCustomers);
router.get('/customers/:id', getCustomer);

// ── Promo Codes ───────────────────────────────
router.get('/promo-codes',        getAllPromoCodes);
router.post('/promo-codes',       createPromoCode);
router.delete('/promo-codes/:id', deletePromoCode);

module.exports = router;
