function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed && trimmed !== 'null' ? trimmed : null;
}

function normalizeSize(value) {
  return normalizeText(value);
}

function normalizeColor(value) {
  return normalizeText(value);
}

function normalizeStockMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeSizeStocks(value) {
  return normalizeStockMap(value);
}

function normalizeVariantStocks(value) {
  return normalizeStockMap(value);
}

function normalizeStockValue(value) {
  const stock = Number(value);
  return Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : null;
}

function parseColorToken(colorToken) {
  const raw = normalizeColor(colorToken);
  if (!raw) return { raw: null, name: null };
  const sep = raw.indexOf('::');
  return {
    raw,
    name: sep === -1 ? raw : normalizeColor(raw.slice(0, sep)),
  };
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function getVariantStockValue(variantStocks, color, size) {
  const { raw: rawColor, name: displayColor } = parseColorToken(color);
  const sizeKey = normalizeSize(size);
  if (!rawColor) return null;

  const colorKeys = uniqueValues([rawColor, displayColor]);
  const sizeKeys = uniqueValues([sizeKey, 'default']);

  for (const colorKey of colorKeys) {
    const nested = variantStocks[colorKey];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const key of sizeKeys) {
        if (Object.prototype.hasOwnProperty.call(nested, key)) {
          return normalizeStockValue(nested[key]);
        }
      }
    }
  }

  for (const colorKey of colorKeys) {
    for (const key of sizeKeys) {
      const compositeKey = `${colorKey}::${key}`;
      if (Object.prototype.hasOwnProperty.call(variantStocks, compositeKey)) {
        return normalizeStockValue(variantStocks[compositeKey]);
      }
    }
  }

  for (const colorKey of colorKeys) {
    if (!sizeKey && Object.prototype.hasOwnProperty.call(variantStocks, colorKey)) {
      return normalizeStockValue(variantStocks[colorKey]);
    }
  }

  return null;
}

function getVariantStock(product, size, color) {
  const colorKey = normalizeColor(color);
  const sizeKey = normalizeSize(size);
  const variantStocks = normalizeVariantStocks(product && product.variant_stocks);

  if (colorKey) {
    const variantStock = getVariantStockValue(variantStocks, colorKey, sizeKey);
    return variantStock === null ? 0 : variantStock;
  }

  if (Object.keys(variantStocks).length > 0) {
    return 0;
  }

  const sizeStocks = normalizeSizeStocks(product && product.size_stocks);
  if (sizeKey && Object.prototype.hasOwnProperty.call(sizeStocks, sizeKey)) {
    const stock = normalizeStockValue(sizeStocks[sizeKey]);
    return stock === null ? 0 : stock;
  }

  const stock = normalizeStockValue(product && product.stock);
  return stock === null ? 0 : stock;
}

function createStockError({ productId, productName, requested, available, size, color }) {
  const variantParts = [color, size].filter(Boolean).join(' / ');
  const variantText = variantParts ? ` (${variantParts})` : '';
  const err = new Error(
    `Only ${available} left in stock for ${productName || `product ${productId}`}${variantText}. Requested ${requested}.`
  );
  err.status = 400;
  err.code = 'INSUFFICIENT_STOCK';
  err.details = {
    product_id: Number(productId),
    product_name: productName || null,
    color: color || null,
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
    const color = normalizeColor(item.color);

    if (!Number.isInteger(productId) || !quantity) continue;

    byProduct.set(productId, (byProduct.get(productId) || 0) + quantity);

    const variantKey = `${productId}::${color || ''}::${size || ''}`;
    const current = byVariant.get(variantKey) || { productId, color, size, quantity: 0 };
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
    const available = Number(product.stock) || 0;
    if (requested > available) {
      throw createStockError({
        productId,
        productName: product.name,
        requested,
        available,
        size: null,
        color: null,
      });
    }
  }

  for (const { productId, color, size, quantity } of byVariant.values()) {
    const product = productSnapshots.get(productId);
    if (!product) continue;

    const hasVariantStocks = Object.keys(normalizeVariantStocks(product.variant_stocks)).length > 0;
    const hasSizeStocks = Object.prototype.hasOwnProperty.call(normalizeSizeStocks(product.size_stocks), size);
    if (!color && !size && !hasVariantStocks) continue;
    if (!color && size && !hasVariantStocks && !hasSizeStocks) continue;

    const available = getVariantStock(product, size, color);
    if (quantity > available) {
      throw createStockError({
        productId,
        productName: product.name,
        requested: quantity,
        available,
        size,
        color,
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
    `SELECT id, name, stock, size_stocks, variant_stocks
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
    variant_stocks: normalizeVariantStocks(row.variant_stocks),
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
  getVariantStockValue,
  normalizeColor,
  normalizeSize,
  normalizeSizeStocks,
  normalizeVariantStocks,
  parseColorToken,
  validateOrderStock,
  validateRequestedStock,
};
