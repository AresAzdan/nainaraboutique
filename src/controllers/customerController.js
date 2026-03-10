const db = require('../config/db');
const { createError } = require('../middleware/errorHandler');

// GET /api/admin/customers
// Returns all users (role='user') with order statistics
const getAllCustomers = async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.created_at,
        COUNT(o.id)                          AS total_orders,
        COALESCE(SUM(o.total_amount), 0)     AS total_spent,
        MAX(o.created_at)                    AS last_order_date
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.role = 'user'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    // Shape data to match what the frontend expects
    const customers = result.rows.map(row => ({
      id:            row.id,
      name:          row.name,
      email:         row.email,
      phone:         row.phone || '-',          // not in schema yet, safe fallback
      joinDate:      row.created_at
                       ? new Date(row.created_at).toISOString().split('T')[0]
                       : '-',
      totalOrders:   parseInt(row.total_orders, 10),
      totalSpent:    parseFloat(row.total_spent),
      lastOrderDate: row.last_order_date
                       ? new Date(row.last_order_date).toISOString().split('T')[0]
                       : '-',
      status:        parseInt(row.total_orders, 10) > 0 ? 'Active' : 'Inactive',
    }));

    res.json(customers);
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/customers/:id
// Single customer with order history
const getCustomer = async (req, res, next) => {
  try {
    const userResult = await db.query(
      `SELECT id, name, email, created_at
       FROM users WHERE id = $1 AND role = 'user'`,
      [req.params.id]
    );
    if (!userResult.rows.length) throw createError(404, 'Customer not found.');

    const user = userResult.rows[0];

    const ordersResult = await db.query(
      `SELECT id, total_amount, status, created_at
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.id]
    );

    const orders = ordersResult.rows.map(o => ({
      id:     o.id,
      date:   new Date(o.created_at).toISOString().split('T')[0],
      total:  parseFloat(o.total_amount),
      status: o.status,
    }));

    const totalSpent  = orders.reduce((sum, o) => sum + o.total, 0);

    res.json({
      id:           user.id,
      name:         user.name,
      email:        user.email,
      phone:        user.phone || '-',
      joinDate:     new Date(user.created_at).toISOString().split('T')[0],
      totalOrders:  orders.length,
      totalSpent,
      orders,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllCustomers, getCustomer };
