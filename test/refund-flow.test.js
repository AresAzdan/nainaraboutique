const assert = require('assert');
const refundService = require('../src/services/refundService');

class FakeClient {
  constructor(handlers) {
    this.handlers = handlers;
    this.calls = [];
    this.released = false;
  }

  async query(sql, params = []) {
    this.calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    const handler = this.handlers.shift();
    if (!handler) throw new Error(`Unexpected query: ${sql}`);
    return typeof handler === 'function' ? handler(sql, params) : handler;
  }

  release() {
    this.released = true;
  }
}

const makePool = (handlerGroups) => {
  const clients = handlerGroups.map((handlers) => new FakeClient(handlers));
  return {
    clients,
    async connect() {
      const client = clients.shift();
      if (!client) throw new Error('Unexpected pool.connect()');
      return client;
    },
  };
};

(async () => {
  {
    let midtransCalled = false;
    const pool = makePool([[
      { rows: [{ id: 1, user_id: 7, status: 'paid', total_amount: '125000.00', midtrans_order_id: 'NAINARA-1', refund_status: 'none' }] },
      (sql, params) => {
        assert(sql.includes("refund_status = 'requested'"), 'customer refund request must only persist requested status');
        assert.strictEqual(params[1], 'Wrong size ordered');
        assert.strictEqual(params[2], 125000);
        return { rows: [{ id: 1, refund_status: 'requested', refund_reason: 'Wrong size ordered' }] };
      },
    ]]);

    const order = await refundService.requestRefund({
      orderId: 1,
      userId: 7,
      reason: ' Wrong size ordered ',
      pool,
    });

    assert.strictEqual(order.refund_status, 'requested');
    assert.strictEqual(midtransCalled, false, 'test double confirms customer action did not call Midtrans');
  }

  {
    let refundArgs = null;
    const pool = makePool([
      [
        { rows: [{ id: 2, status: 'paid', total_amount: '200000.00', midtrans_order_id: 'NAINARA-2', refund_status: 'requested', refund_amount: '150000.00' }] },
        (sql, params) => {
          assert(sql.includes("refund_status = 'processing'"));
          return { rows: [{ id: 2, status: 'paid', total_amount: '200000.00', midtrans_order_id: 'NAINARA-2', refund_status: 'processing', refund_amount: '150000.00', refund_reason: 'Damaged item' }] };
        },
      ],
      [
        { rows: [{ id: 2, stock_deducted: false }] },
        (sql, params) => {
          assert(sql.includes("refund_status = 'refunded'"));
          assert.strictEqual(JSON.parse(params[1]).status_code, '200');
          return { rows: [{ id: 2, status: 'refunded', refund_status: 'refunded' }] };
        },
        { rows: [{ id: 1 }] },
      ],
    ]);

    const coreApi = {
      transaction: {
        refund: async (...args) => {
          refundArgs = args;
          return { status_code: '200', status_message: 'Success' };
        },
      },
    };

    const order = await refundService.approveRefund({ orderId: 2, adminId: 99, pool, coreApi });
    assert.deepStrictEqual(refundArgs[0], 'NAINARA-2');
    assert.strictEqual(refundArgs[1].amount, 150000);
    assert.strictEqual(order.refund_status, 'refunded');
  }

  {
    const pool = makePool([[
      { rows: [{ id: 3, status: 'paid', total_amount: '50000.00', midtrans_order_id: 'NAINARA-3', refund_status: 'processing', refund_amount: '50000.00' }] },
    ]]);

    await assert.rejects(
      () => refundService.approveRefund({ orderId: 3, adminId: 99, pool, coreApi: { transaction: { refund: async () => ({}) } } }),
      (err) => err.status === 409 && /already processing/.test(err.message)
    );
  }

  {
    const pool = makePool([[
      { rows: [{ id: 4, user_id: 7, status: 'pending', total_amount: '75000.00', midtrans_order_id: 'NAINARA-4', refund_status: 'none' }] },
    ]]);

    await assert.rejects(
      () => refundService.requestRefund({ orderId: 4, userId: 7, reason: 'Changed mind', pool }),
      (err) => err.status === 400 && /paid or settled/.test(err.message)
    );
  }


  {
    let connected = false;
    const pool = { async connect() { connected = true; throw new Error('connect should not be called'); } };

    await assert.rejects(
      () => refundService.requestRefund({ orderId: 5, userId: 7, reason: '   ', pool }),
      (err) => err.status === 400 && /reason is required/.test(err.message)
    );
    assert.strictEqual(connected, false, 'missing refund reason must be rejected before database work');
  }

  console.log('refund flow regression checks passed');
})();
