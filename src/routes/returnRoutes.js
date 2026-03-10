const router = require('express').Router();
const {
  createReturn,
  getMyReturns,
  getMyReturn,
} = require('../controllers/returnController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// POST /api/returns  — submit a return request
router.post('/', createReturn);

// GET /api/returns  — list my return requests
router.get('/', getMyReturns);

// GET /api/returns/:id  — single return detail
router.get('/:id', getMyReturn);

module.exports = router;
