const db           = require('../config/db');
const OrderModel   = require('../models/orderModel');
const ReturnModel  = require('../models/returnModel');
const { createError } = require('../middleware/errorHandler');

const RETURN_WINDOW_DAYS = 5; // days after delivery

// ─────────────────────────────────────────────
// CUSTOMER: POST /api/returns
// ─────────────────────────────────────────────
// Body: { order_id, order_item_id, reason, new_size, video_url }
//
// Rules:
//  - Order must be "completed" (delivered)
//  - Within 5 days of delivered_at
//  - Must provide unboxing video URL
//  - Cannot change product (same product_id)
//  - Cannot change color (only size exchange)
//  - One return per order item
// ─────────────────────────────────────────────
const createReturn = async (req, res, next) => {
  try {
    const { order_id, order_item_id, reason, new_size, video_url } = req.body;

    // ── Validate required fields ──
    if (!order_id || !order_item_id || !reason || !new_size || !video_url) {
      throw createError(400, 'All fields are required: order_id, order_item_id, reason, new_size, video_url.');
    }

    // ── 1. Fetch order ──
    const order = await OrderModel.findById(order_id);
    if (!order) throw createError(404, 'Order not found.');

    // ── 2. Ownership check ──
    if (order.user_id !== req.user.id) {
      throw createError(403, 'You can only request returns for your own orders.');
    }

    // ── 3. Order must be completed (delivered) ──
    if (order.status !== 'completed') {
      throw createError(400, 'Returns are only allowed for delivered (completed) orders.');
    }

    // ── 4. Check delivery date exists ──
    if (!order.delivered_at) {
      throw createError(400, 'Delivery date not recorded. Please contact support.');
    }

    // ── 5. Check 5-day return window ──
    const deliveredAt = new Date(order.delivered_at);
    const now         = new Date();
    const diffDays    = (now - deliveredAt) / (1000 * 60 * 60 * 24);

    if (diffDays > RETURN_WINDOW_DAYS) {
      throw createError(400, `Return window has expired. Returns must be requested within ${RETURN_WINDOW_DAYS} days of delivery.`);
    }

    // ── 6. Verify the order item belongs to this order ──
    const orderItems = await OrderModel.getOrderItems(order_id);
    const targetItem = orderItems.find(item => item.id === Number(order_item_id));

    if (!targetItem) {
      throw createError(404, 'Order item not found in this order.');
    }

    // ── 7. Check no duplicate return for this item ──
    const alreadyRequested = await ReturnModel.existsForOrderItem(order_item_id);
    if (alreadyRequested) {
      throw createError(400, 'A return request already exists for this item.');
    }

    // ── 8. Validate video URL format (basic check) ──
    try {
      new URL(video_url);
    } catch {
      throw createError(400, 'video_url must be a valid URL.');
    }

    // ── 9. Create return request ──
    const returnReq = await ReturnModel.create({
      orderId:     order_id,
      userId:      req.user.id,
      orderItemId: order_item_id,
      reason,
      newSize:     new_size,
      videoUrl:    video_url,
    });

    // ── 10. Update order status ──
    await db.query(
      'UPDATE orders SET status = $1 WHERE id = $2',
      ['return_requested', order_id]
    );

    res.status(201).json({
      message: 'Return request submitted successfully.',
      return_request: returnReq,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// CUSTOMER: GET /api/returns
// ─────────────────────────────────────────────
const getMyReturns = async (req, res, next) => {
  try {
    const returns = await ReturnModel.findByUserId(req.user.id);
    res.json(returns);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// CUSTOMER: GET /api/returns/:id
// ─────────────────────────────────────────────
const getMyReturn = async (req, res, next) => {
  try {
    const returnReq = await ReturnModel.findById(req.params.id);
    if (!returnReq) throw createError(404, 'Return request not found.');
    if (returnReq.user_id !== req.user.id) {
      throw createError(403, 'Access denied.');
    }
    res.json(returnReq);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// ADMIN: GET /api/admin/returns
// ─────────────────────────────────────────────
const getAllReturns = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const returns = await ReturnModel.findAll({ page: Number(page), limit: Number(limit) });
    res.json({ page: Number(page), limit: Number(limit), data: returns });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// ADMIN: PATCH /api/admin/returns/:id
// Body: { status: 'approved' | 'rejected', admin_notes? }
// ─────────────────────────────────────────────
const reviewReturn = async (req, res, next) => {
  try {
    const { status, admin_notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      throw createError(400, 'Status must be "approved" or "rejected".');
    }

    const returnReq = await ReturnModel.findById(req.params.id);
    if (!returnReq) throw createError(404, 'Return request not found.');

    if (returnReq.status !== 'pending') {
      throw createError(400, `This return has already been ${returnReq.status}.`);
    }

    const updated = await ReturnModel.updateStatus(req.params.id, status, admin_notes || null);

    // If approved, update order status to 'returned'
    if (status === 'approved') {
      await db.query(
        'UPDATE orders SET status = $1 WHERE id = $2',
        ['returned', returnReq.order_id]
      );
    }

    // If rejected, revert order status back to 'completed'
    if (status === 'rejected') {
      await db.query(
        'UPDATE orders SET status = $1 WHERE id = $2',
        ['completed', returnReq.order_id]
      );
    }

    res.json({
      message: `Return request ${status}.`,
      return_request: updated,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { createReturn, getMyReturns, getMyReturn, getAllReturns, reviewReturn };
