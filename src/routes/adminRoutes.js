const router = require('express').Router();
const { authenticate, authorizeAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');

const { getAllReturns, reviewReturn } = require('../controllers/returnController');
const { createProduct, updateProduct, deleteProduct } = require('../controllers/productController');
const { createCategory, updateCategory, deleteCategory } = require('../controllers/categoryController');

// FIX E — import all three admin order handlers from orderController
// These are now properly defined and exported so this import will not throw
const { getAllOrders, adminGetOrder, adminUpdateOrderStatus, adminDeleteOrder } = require('../controllers/orderController');

const { getAllDiscounts, createDiscount, updateDiscount, deleteDiscount } = require('../controllers/discountController');
const { getAllCustomers, getCustomer } = require('../controllers/customerController');
const { getActivityLogs } = require('../controllers/activityController');
const { getAllPromoCodes, createPromoCode, updatePromoCode, deletePromoCode } = require('../controllers/promoController');
const { uploadImages } = require('../controllers/uploadController');
const { updateHomepage } = require('../controllers/settingsController');
const { getSizeGuides, createSizeGuide, updateSizeGuide, deleteSizeGuide } = require('../controllers/sizeGuideController');

// All admin routes require authentication + admin role
router.use(authenticate, authorizeAdmin);

// ── Activity Logs ─────────────────────────────
router.get('/activity-logs', getActivityLogs);

// ── Returns ───────────────────────────────────
router.get('/returns', getAllReturns);
router.patch('/returns/:id', reviewReturn);

// ── Homepage Settings ─────────────────────────
router.put('/homepage', updateHomepage);

// ── Upload ────────────────────────────────────
router.post('/upload', ...uploadImages);

// ── Size Guides ────────────────────────────────
router.get('/size-guides',       getSizeGuides);
router.post('/size-guides',      createSizeGuide);
router.put('/size-guides/:id',   updateSizeGuide);
router.delete('/size-guides/:id', deleteSizeGuide);

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
router.delete('/orders/:id',        adminDeleteOrder);

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
router.put('/promo-codes/:id',    updatePromoCode);
router.delete('/promo-codes/:id', deletePromoCode);

module.exports = router;
