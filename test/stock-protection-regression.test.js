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
    [1, { id: 1, name: 'Stock One Dress', stock: 1, size_stocks: {}, variant_stocks: {} }],
  ]);

  assert.throws(
    () => validateRequestedStock([{ product_id: 1, quantity: 2 }], stockOneProduct),
    (err) => err.status === 400 && err.code === 'INSUFFICIENT_STOCK',
    'product stock = 1 and requested qty = 2 must be rejected before order creation'
  );

  const fakeDb = {
    async query(sql, values) {
      assert(sql.includes('FROM products'), 'stock validation must read authoritative products table');
      assert(sql.includes('variant_stocks'), 'stock validation must read color + size variant stocks');
      assert.deepStrictEqual(values, [[1]], 'stock validation should query requested product ids');
      return { rows: [{ id: 1, name: 'Stock One Dress', stock: 1, size_stocks: {}, variant_stocks: {} }] };
    },
  };

  await assert.rejects(
    () => validateOrderStock([{ product_id: 1, quantity: 2 }], fakeDb),
    (err) => err.status === 400 && err.code === 'INSUFFICIENT_STOCK',
    'backend order validation must reject qty above current DB stock'
  );

  assert.strictEqual(
    getVariantStock({ stock: 5, size_stocks: { S: 1, M: 3 }, variant_stocks: {} }, 'S'),
    1,
    'legacy selected size stock can be used only when no color variant is selected'
  );


  assert.strictEqual(
    getVariantStock({ stock: 5, size_stocks: { S: 2 }, variant_stocks: {} }, 'S', 'Blue'),
    2,
    'selected color must fall back to legacy size stock when variant_stocks is empty'
  );

  assert.strictEqual(
    getVariantStock({ stock: 5, size_stocks: { S: 2 }, variant_stocks: { Red: { S: 1 } } }, 'S', 'Blue'),
    2,
    'selected color must fall back to legacy size stock when variant_stocks does not contain that color'
  );

  assert.strictEqual(
    getVariantStock({ stock: 5, size_stocks: {}, variant_stocks: { Red: { S: 1 } } }, 'S', 'Blue'),
    0,
    'selected color must not fall back to product stock when per-color stock data exists but has no matching color'
  );

  assert.strictEqual(
    getVariantStock({ stock: 5, size_stocks: { S: 2 }, variant_stocks: { Blue: { S: 0 } } }, 'S', 'Blue'),
    0,
    'populated selected color-size variant stock of 0 must still be enforced'
  );

  const colorSizeProduct = {
    id: 2,
    name: 'Variant Dress',
    stock: 4,
    size_stocks: { XL: 4 },
    variant_stocks: {
      'Color A': { XL: 4 },
      'Color B': { XL: 0 },
    },
  };

  assert.strictEqual(
    getVariantStock(colorSizeProduct, 'XL', 'Color A'),
    4,
    'Color A + XL must expose the specific color-size stock of 4'
  );
  assert.strictEqual(
    getVariantStock(colorSizeProduct, 'XL', 'Color B'),
    0,
    'Color B + XL must expose the specific color-size stock of 0, not total product stock'
  );

  validateRequestedStock([{ product_id: 2, quantity: 4, size: 'XL', color: 'Color A' }], new Map([[2, colorSizeProduct]]));

  assert.throws(
    () => validateRequestedStock([{ product_id: 2, quantity: 1, size: 'XL', color: 'Color B' }], new Map([[2, colorSizeProduct]])),
    (err) => err.status === 400 && err.details.color === 'Color B' && err.details.size === 'XL' && err.details.available === 0,
    'backend must reject checkout for Color B + XL qty 1 when that color-size variant has 0 stock'
  );


  validateRequestedStock([{ product_id: 3, quantity: 2, size: 'S', color: 'Blue' }], new Map([
    [3, { id: 3, name: 'Legacy Blue Dress', stock: 5, size_stocks: { S: 2 }, variant_stocks: { Red: { S: 1 } } }],
  ]));

  assert.throws(
    () => validateRequestedStock([{ product_id: 3, quantity: 3, size: 'S', color: 'Blue' }], new Map([
      [3, { id: 3, name: 'Legacy Blue Dress', stock: 5, size_stocks: { S: 2 }, variant_stocks: { Red: { S: 1 } } }],
    ])),
    (err) => err.status === 400 && err.details.color === 'Blue' && err.details.size === 'S' && err.details.available === 2,
    'backend validation must use size_stocks fallback when selected color has no variant_stocks entry'
  );



  const realFlatColorStockShape = {
    stock: 18,
    size_stocks: {
      black: 1,
      ivory: 2,
      '#000000': 2,
      'Peach:#FFA491': 1,
    },
    variant_stocks: {},
  };

  assert.strictEqual(
    getVariantStock(realFlatColorStockShape, '140cm', 'black'),
    1,
    'real flat color stock shape must resolve selected color black to stock 1 even when a one-size size is selected'
  );
  assert.strictEqual(
    getVariantStock(realFlatColorStockShape, 'One Size', 'ivory'),
    2,
    'real flat color stock shape must resolve selected color ivory to stock 2'
  );
  assert.strictEqual(
    getVariantStock(realFlatColorStockShape, '140cm', '#000000'),
    2,
    'real flat color stock shape must resolve selected hex color #000000 to stock 2'
  );
  assert.strictEqual(
    getVariantStock(realFlatColorStockShape, 'One Size', 'Peach::#FFA491'),
    1,
    'real flat color stock shape must match selected combined Peach/#FFA491 color to stock 1'
  );

  assert.strictEqual(
    getVariantStock({ stock: 18, size_stocks: {}, variant_stocks: realFlatColorStockShape.size_stocks }, 'One Size', 'Peach:#FFA491'),
    1,
    'the same flat production color stock shape must also be supported when it is stored in variant_stocks'
  );

  assert.throws(
    () => validateRequestedStock([{ product_id: 4, quantity: 2, size: '140cm', color: 'black' }], new Map([
      [4, { id: 4, name: 'Real Shape Dress', ...realFlatColorStockShape }],
    ])),
    (err) => err.status === 400 && err.details.available === 1,
    'checkout validation must reject cart quantities above the selected flat color stock'
  );

  const variantDb = {
    async query() {
      return { rows: [colorSizeProduct] };
    },
  };

  await assert.rejects(
    () => validateOrderStock([{ product_id: 2, quantity: 1, size: 'XL', color: 'Color B' }], variantDb),
    (err) => err.status === 400 && err.code === 'INSUFFICIENT_STOCK',
    'backend DB validation must reject Color B + XL qty 1'
  );

  assert.strictEqual(
    getVariantStock({ stock: 5, size_stocks: { S: 1, M: 3 }, variant_stocks: {} }, 'S'),
    1,
    'selected size stock must override product-level stock when size stock exists'
  );

  assert.throws(
    () => validateRequestedStock([{ product_id: 2, quantity: 2, size: 'S' }], new Map([
      [2, { id: 2, name: 'Variant Dress', stock: 5, size_stocks: { S: 1, M: 4 }, variant_stocks: {} }],
    ])),
    (err) => err.status === 400 && err.details.size === 'S' && err.details.available === 1,
    'variant stock = 1 and requested qty = 2 must be rejected'
  );

  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert(inlineScripts.length > 0, 'index.html must contain inline app scripts to parse');
  for (const [, script] of inlineScripts) {
    assert.doesNotThrow(() => new Function(script), 'frontend inline scripts must parse without duplicate declarations or syntax errors');
  }

  assert(
    indexHtml.includes('const colorSizeStock = this.getColorStockFromMap(sizeStocks, colorKey, sizeKey)')
      && indexHtml.includes('if (this.hasStockMapEntries(variantStocks) || this.hasStockMapEntries(sizeStocks)) return 0'),
    'frontend stock resolution must read admin size_stocks color data and only fall back to product stock when no variant/size stock data exists'
  );

  assert(
    indexHtml.includes('this.getAvailableStock(p, s, this.data.selectedColor)'),
    'product page size stock must use selected color + selected size'
  );
  assert(
    indexHtml.includes('this.updateProductStockUI(product)') && indexHtml.includes('this.data.selectedColor = colorName || null'),
    'product page must refresh stock text when selected color changes'
  );
  assert(
    indexHtml.includes('plusDisabled = availableStock <= 0 || item.qty >= availableStock'),
    'cart + button must be disabled when quantity reaches selected variant stock'
  );
  assert(
    indexHtml.includes('this.getAvailableStock(product, item.size, item.color)'),
    'cart quantity limit must use selected color + selected size stock'
  );
  assert(
    indexHtml.includes('variant_stocks: item.variant_stocks') && indexHtml.includes('size_stocks: item.size_stocks'),
    'API product loader must preserve variant_stocks and size_stocks for frontend stock checks'
  );
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
