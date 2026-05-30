const assert = require('assert');
const dbPath = require.resolve('../src/config/db');

const fakeDb = {
  async query() {
    throw new Error('Unexpected direct database query in test double');
  },
  connect() {
    throw new Error('Unexpected database connection in test double');
  },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const OrderModel = require('../src/models/orderModel');
const orderController = require('../src/controllers/orderController');

const makeRes = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

(async () => {
  {
    let capturedSql = '';
    let capturedParams = null;
    fakeDb.query = async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [{
          id: 10,
          status: 'shipped',
          tracking_number: 'JP1234567890',
          tracking_courier: 'JNE',
        }],
      };
    };

    const order = await OrderModel.updateStatus(10, 'shipped', {
      trackingNumber: 'JP1234567890',
      trackingCourier: 'JNE',
    });

    assert.strictEqual(order.tracking_number, 'JP1234567890');
    assert.strictEqual(order.tracking_courier, 'JNE');
    assert(capturedSql.includes('tracking_number'), 'status update must persist tracking_number');
    assert(capturedSql.includes('tracking_courier'), 'status update must persist tracking_courier');
    assert(capturedSql.includes('delivered_at'), 'completed status update must set delivered_at when appropriate');
    assert.deepStrictEqual(capturedParams, ['shipped', 10, 'JP1234567890', 'JNE']);
  }

  {
    let findCalled = false;
    const originalFindById = OrderModel.findById;
    const originalUpdateStatus = OrderModel.updateStatus;
    OrderModel.findById = async () => { findCalled = true; };
    OrderModel.updateStatus = async () => { throw new Error('updateStatus should not be called without tracking data'); };

    const missingNumberRes = makeRes();
    await orderController.adminUpdateOrderStatus(
      { params: { id: 11 }, body: { status: 'shipped', tracking_courier: 'JNE' } },
      missingNumberRes
    );
    assert.strictEqual(missingNumberRes.statusCode, 400);
    assert.match(missingNumberRes.body.message, /Tracking number is required/);
    assert.strictEqual(findCalled, false, 'shipment tracking validation must run before database lookup');

    const missingCourierRes = makeRes();
    await orderController.adminUpdateOrderStatus(
      { params: { id: 11 }, body: { status: 'shipped', tracking_number: 'JP1234567890' } },
      missingCourierRes
    );
    assert.strictEqual(missingCourierRes.statusCode, 400);
    assert.match(missingCourierRes.body.message, /Tracking courier is required/);

    OrderModel.findById = originalFindById;
    OrderModel.updateStatus = originalUpdateStatus;
  }

  {
    const originalFindById = OrderModel.findById;
    const originalUpdateStatus = OrderModel.updateStatus;
    let updateArgs = null;
    OrderModel.findById = async () => ({ id: 12 });
    OrderModel.updateStatus = async (...args) => {
      updateArgs = args;
      return {
        id: 12,
        status: 'shipped',
        tracking_number: 'JP1234567890',
        tracking_courier: 'JNE',
      };
    };

    const res = makeRes();
    await orderController.adminUpdateOrderStatus(
      { params: { id: 12 }, body: { status: ' shipped ', tracking_number: ' JP1234567890 ', tracking_courier: ' JNE ' } },
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(updateArgs, [12, 'shipped', { trackingNumber: 'JP1234567890', trackingCourier: 'JNE' }]);
    assert.strictEqual(res.body.order.tracking_number, 'JP1234567890');
    assert.strictEqual(res.body.order.tracking_courier, 'JNE');

    OrderModel.findById = originalFindById;
    OrderModel.updateStatus = originalUpdateStatus;
  }

  console.log('shipment tracking regression checks passed');
})();
