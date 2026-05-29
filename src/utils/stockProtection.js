function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function normalizeSize(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed && trimmed !== 'null' ? trimmed : null;
}

function normalizeSizeStocks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function getVariantStock(product, size) {
  const sizeKey = normalizeSize(size);
  const sizeStocks = normalizeSizeStocks(product && product.size_stocks);

  if (sizeKey && Object.prototype.hasOwnProperty.call(sizeStocks, sizeKey)) {
    const stock = Number(sizeStocks[sizeKey]);
    return Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0;
  }

  const stock = Number(product && product.stock);
  return Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0;
}

function createStockError({ productId, productName, requested, available, size }) {
  const variantText = size ? ` (${size})` : '';
  const err = new Error(
    `Only ${available} left in stock for ${productName || `product ${productId}`}${variantText}. Requested ${requested}.`
  );
  err.status = 400;
  err.code = 'INSUFFICIENT_STOCK';
  err.details = {
    product_id: Number(productId),
    product_name: productName || null,
    size: size || null,
    requested,
    available,
  };
  return err;
}

function aggregateRequestedItems(items) {
  const byProduct = new Map();
  const byVariant = new Map();

  for (const item of items || []) {
    const productId = Number(item.product_id);
    const quantity = normalizePositiveInteger(item.quantity);
    const size = normalizeSize(item.size);

    if (!Number.isInteger(productId) || !quantity) continue;

    byProduct.set(productId, (byProduct.get(productId) || 0) + quantity);

    const variantKey = `${productId}::${size || ''}`;
    const current = byVariant.get(variantKey) || { productId, size, quantity: 0 };
    current.quantity += quantity;
    byVariant.set(variantKey, current);
  }

  return { byProduct, byVariant };
}

function validateRequestedStock(items, productSnapshots) {
  const { byProduct, byVariant } = aggregateRequestedItems(items);

  for (const [productId, requested] of byProduct.entries()) {
    const product = productSnapshots.get(productId);
    if (!product) continue;
    const available = getVariantStock(product, null);
    if (requested > available) {
      throw createStockError({
        productId,
        productName: product.name,
        requested,
        available,
        size: null,
      });
    }
  }

  for (const { productId, size, quantity } of byVariant.values()) {
    if (!size) continue;
    const product = productSnapshots.get(productId);
    if (!product) continue;
    const sizeStocks = normalizeSizeStocks(product.size_stocks);
    if (!Object.prototype.hasOwnProperty.call(sizeStocks, size)) continue;

    const available = getVariantStock(product, size);
    if (quantity > available) {
      throw createStockError({
        productId,
        productName: product.name,
        requested: quantity,
        available,
        size,
      });
    }
  }
}

async function getStockSnapshots(items, queryable, { forUpdate = false } = {}) {
  const productIds = [...new Set((items || [])
    .map(item => Number(item.product_id))
    .filter(Number.isInteger))];

  if (!productIds.length) return new Map();

  const { rows } = await queryable.query(
    `SELECT id, name, stock, size_stocks
     FROM products
     WHERE id = ANY($1::int[])
     ORDER BY id
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [productIds]
  );

  return new Map(rows.map(row => [Number(row.id), {
    id: Number(row.id),
    name: row.name,
    stock: Number(row.stock) || 0,
    size_stocks: normalizeSizeStocks(row.size_stocks),
  }]));
}

async function validateOrderStock(items, queryable, options = {}) {
  const snapshots = await getStockSnapshots(items, queryable, options);
  validateRequestedStock(items, snapshots);
  return snapshots;
}

module.exports = {
  aggregateRequestedItems,
  createStockError,
  getStockSnapshots,
  getVariantStock,
  normalizeSize,
  normalizeSizeStocks,
  validateOrderStock,
  validateRequestedStock,
};
