const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getVariantStock,
  validateOrderStock,
  validateRequestedStock,
} = require('../src/utils/stockProtection');

(async () => {
  const stockOneProduct = new Map([
    [1, { id: 1, name: 'Stock One Dress', stock: 1, size_stocks: {} }],
  ]);

  assert.throws(
    () => validateRequestedStock([{ product_id: 1, quantity: 2 }], stockOneProduct),
    (err) => err.status === 400 && err.code === 'INSUFFICIENT_STOCK',
    'product stock = 1 and requested qty = 2 must be rejected before order creation'
  );

  const fakeDb = {
    async query(sql, values) {
      assert(sql.includes('FROM products'), 'stock validation must read authoritative products table');
      assert.deepStrictEqual(values, [[1]], 'stock validation should query requested product ids');
      return { rows: [{ id: 1, name: 'Stock One Dress', stock: 1, size_stocks: {} }] };
    },
  };

  await assert.rejects(
    () => validateOrderStock([{ product_id: 1, quantity: 2 }], fakeDb),
    (err) => err.status === 400 && err.code === 'INSUFFICIENT_STOCK',
    'backend order validation must reject qty above current DB stock'
  );

  assert.strictEqual(
    getVariantStock({ stock: 5, size_stocks: { S: 1, M: 3 } }, 'S'),
    1,
    'selected size stock must override product-level stock when size stock exists'
  );

  assert.throws(
    () => validateRequestedStock([{ product_id: 2, quantity: 2, size: 'S' }], new Map([
      [2, { id: 2, name: 'Variant Dress', stock: 5, size_stocks: { S: 1, M: 4 } }],
    ])),
    (err) => err.status === 400 && err.details.size === 'S' && err.details.available === 1,
    'variant stock = 1 and requested qty = 2 must be rejected'
  );

  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(
    indexHtml.includes('plusDisabled = availableStock <= 0 || item.qty >= availableStock'),
    'cart + button must be disabled when quantity reaches available stock'
  );
  assert(
    indexHtml.includes('if (item.qty >= availableStock)') && indexHtml.includes('this.showToast(this.formatStockMessage(availableStock))'),
    'cart + handler must block attempts to exceed available stock'
  );
  assert(
    indexHtml.includes('Only ${safeStock} left in stock'),
    'product page must expose a low-stock message such as Only 1 left in stock'
  );

  console.log('stock protection regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
