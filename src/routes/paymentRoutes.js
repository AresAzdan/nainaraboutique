const router = require('express').Router();
const { createPayment } = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

// ─── Authenticated routes ─────────────────────────────────────────────────────
// The public webhook (POST /api/payments/notification) is intentionally NOT here.
// It is mounted directly on the Express app in app.js, before this router is
// registered, so it can never be reached by the authenticate middleware below.
//
// Every route defined in this file requires a valid JWT.
router.use(authenticate);

router.post('/:id', createPayment);

module.exports = router;
