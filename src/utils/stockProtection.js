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

const ONE_SIZE_ALIASES = new Set(['allsize', 'onesize', 'freesize']);

function normalizeSizeAlias(value) {
  const text = normalizeSize(value);
  return text ? text.toLowerCase().replace(/[\s_-]+/g, '') : null;
}

function isOneSizeAlias(value) {
  const alias = normalizeSizeAlias(value);
  if (!alias) return true;
  if (ONE_SIZE_ALIASES.has(alias)) return true;
  return /^\d+(?:\.\d+)?cm$/.test(alias);
}

function hasRealSizeOptions(product) {
  const sizes = Array.isArray(product && product.sizes) ? product.sizes : [];
  const normalizedSizes = sizes.map(normalizeSize).filter(Boolean);
  return normalizedSizes.some(size => !isOneSizeAlias(size));
}

function isOneSizeRequest(product, size) {
  const sizeKey = normalizeSize(size);
  if (isOneSizeAlias(sizeKey)) return true;
  return !hasRealSizeOptions(product);
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
  if (!raw) return { raw: null, name: null, color: null };

  const doubleColonSep = raw.indexOf('::');
  if (doubleColonSep !== -1) {
    return {
      raw,
      name: normalizeColor(raw.slice(0, doubleColonSep)),
      color: normalizeColor(raw.slice(doubleColonSep + 2)),
    };
  }

  const nameHexMatch = raw.match(/^(.+?):\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)$/);
  if (nameHexMatch) {
    return {
      raw,
      name: normalizeColor(nameHexMatch[1]),
      color: normalizeColor(nameHexMatch[2]),
    };
  }

  const isHex = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(raw);
  return {
    raw,
    name: isHex ? null : raw,
    color: isHex ? raw : null,
  };
}

function normalizeLookupKey(value) {
  const text = normalizeText(value);
  return text ? text.toLowerCase().replace(/\s+/g, '') : null;
}

function colorLookupCandidates(colorToken) {
  const parsed = parseColorToken(colorToken);
  if (!parsed.raw) return [];
  const combined = [];
  if (parsed.name && parsed.color) {
    combined.push(`${parsed.name}::${parsed.color}`, `${parsed.name}:${parsed.color}`);
  }
  return uniqueValues([parsed.raw, parsed.name, parsed.color, ...combined]);
}

function findMatchingOwnKey(map, candidates) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const keys = Object.keys(map);

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(map, candidate)) return candidate;
  }

  const normalizedCandidates = new Set(candidates.map(normalizeLookupKey).filter(Boolean));
  return keys.find(key => normalizedCandidates.has(normalizeLookupKey(key))) || null;
}

function getStockValueForKey(map, candidates) {
  const key = findMatchingOwnKey(map, candidates);
  if (key === null) return null;
  return normalizeStockValue(map[key]);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function getColorStockValue(stockMap, color, size, { allowFlatColorFallback = true } = {}) {
  if (!stockMap || typeof stockMap !== 'object' || Array.isArray(stockMap)) return null;

  const colorKeys = colorLookupCandidates(color);
  const sizeKey = normalizeSize(size);
  const sizeKeys = uniqueValues([sizeKey, 'default']);
  if (!colorKeys.length) return null;

  const outerColorKey = findMatchingOwnKey(stockMap, colorKeys);
  if (outerColorKey !== null) {
    const nested = stockMap[outerColorKey];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const nestedStock = getStockValueForKey(nested, sizeKeys);
      if (nestedStock !== null) return nestedStock;
    }
  }

  for (const colorKey of colorKeys) {
    for (const key of sizeKeys) {
      const compositeStock = getStockValueForKey(stockMap, [`${colorKey}::${key}`]);
      if (compositeStock !== null) return compositeStock;
    }
  }

  if (allowFlatColorFallback) {
    const flatColorStock = getStockValueForKey(stockMap, colorKeys);
    if (flatColorStock !== null) return flatColorStock;
  }

  return null;
}

function getVariantStockValue(variantStocks, color, size, options) {
  return getColorStockValue(variantStocks, color, size, options);
}

function hasStockMapEntries(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function resolveAvailableStock(product, size, color) {
  const sizeKey = normalizeSize(size);
  const colorKey = normalizeColor(color);
  const variantStocks = normalizeVariantStocks(product && product.variant_stocks);
  const sizeStocks = normalizeSizeStocks(product && product.size_stocks);

  const oneSizeRequest = isOneSizeRequest(product, sizeKey);

  if (colorKey) {
    const variantStock = getVariantStockValue(variantStocks, colorKey, sizeKey, { allowFlatColorFallback: oneSizeRequest });
    if (variantStock !== null) {
      return { available: variantStock, source: 'variant' };
    }

    const colorSizeStock = getColorStockValue(sizeStocks, colorKey, sizeKey, { allowFlatColorFallback: oneSizeRequest });
    if (colorSizeStock !== null) {
      return { available: colorSizeStock, source: 'size_color' };
    }
  }

  if (sizeKey) {
    const stock = getStockValueForKey(sizeStocks, [sizeKey]);
    if (stock !== null) {
      return { available: stock, source: 'size' };
    }
  }

  if (hasStockMapEntries(variantStocks) || hasStockMapEntries(sizeStocks)) {
    return { available: 0, source: 'unmatched_variant' };
  }

  const stock = normalizeStockValue(product && product.stock);
  return { available: stock === null ? 0 : stock, source: 'product' };
}

function getVariantStock(product, size, color) {
  return resolveAvailableStock(product, size, color).available;
}

function applyNestedStockDelta(stocks, outerKey, innerKey, delta) {
  const currentOuter = stocks[outerKey];
  if (!currentOuter || typeof currentOuter !== 'object' || Array.isArray(currentOuter)) return stocks;
  if (!Object.prototype.hasOwnProperty.call(currentOuter, innerKey)) return stocks;

  const current = Number(currentOuter[innerKey]) || 0;
  const next = current + delta;
  if (next < 0) throw new Error(`Insufficient stock for ${outerKey} / ${innerKey}`);

  return { ...stocks, [outerKey]: { ...currentOuter, [innerKey]: next } };
}

function applyFlatStockDelta(stocks, key, delta) {
  if (!Object.prototype.hasOwnProperty.call(stocks, key)) return stocks;
  const current = Number(stocks[key]) || 0;
  const next = current + delta;
  if (next < 0) throw new Error(`Insufficient stock for ${key}`);
  return { ...stocks, [key]: next };
}

function applyMatchedFlatStockDelta(stocks, candidates, delta) {
  const key = findMatchingOwnKey(stocks, candidates);
  return key === null ? stocks : applyFlatStockDelta(stocks, key, delta);
}

function applyColorStockDelta(stocks, size, color, delta) {
  const sizeKey = normalizeSize(size);
  const sizeKeys = uniqueValues([sizeKey, 'default']);
  const colorKeys = colorLookupCandidates(color);

  const outerColorKey = findMatchingOwnKey(stocks, colorKeys);
  if (outerColorKey !== null) {
    for (const key of sizeKeys) {
      const nextStocks = applyNestedStockDelta(stocks, outerColorKey, key, delta);
      if (nextStocks !== stocks) return nextStocks;
    }
  }

  for (const colorKey of colorKeys) {
    for (const key of sizeKeys) {
      const nextStocks = applyMatchedFlatStockDelta(stocks, [`${colorKey}::${key}`], delta);
      if (nextStocks !== stocks) return nextStocks;
    }
  }

  const nextStocks = applyMatchedFlatStockDelta(stocks, colorKeys, delta);
  if (nextStocks !== stocks) return nextStocks;

  return stocks;
}

function applyVariantStockDelta(product, size, color, delta) {
  return applyColorStockDelta(normalizeVariantStocks(product && product.variant_stocks), size, color, delta);
}

function applySizeStockDelta(product, size, delta) {
  const sizeKey = normalizeSize(size) || 'default';
  return applyFlatStockDelta(normalizeSizeStocks(product && product.size_stocks), sizeKey, delta);
}

function applyResolvedStockDelta(product, size, color, source, delta) {
  if (source === 'variant') {
    return { stocks: applyVariantStockDelta(product, size, color, delta), updateVariantStocks: true, updateSizeStocks: false };
  }
  if (source === 'size_color') {
    return { stocks: applyColorStockDelta(normalizeSizeStocks(product && product.size_stocks), size, color, delta), updateVariantStocks: false, updateSizeStocks: true };
  }
  if (source === 'size') {
    return { stocks: applySizeStockDelta(product, size, delta), updateVariantStocks: false, updateSizeStocks: true };
  }
  return { stocks: {}, updateVariantStocks: false, updateSizeStocks: false };
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
    if (hasStockMapEntries(product.variant_stocks) || hasStockMapEntries(product.size_stocks)) continue;
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

    if (!color && !size) continue;

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
    `SELECT id, name, stock, sizes, size_stocks, variant_stocks
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
    sizes: Array.isArray(row.sizes) ? row.sizes : [],
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
  applyResolvedStockDelta,
  createStockError,
  colorLookupCandidates,
  findMatchingOwnKey,
  getStockSnapshots,
  getVariantStock,
  hasRealSizeOptions,
  isOneSizeAlias,
  isOneSizeRequest,
  getVariantStockValue,
  normalizeColor,
  normalizeSize,
  normalizeSizeStocks,
  normalizeVariantStocks,
  parseColorToken,
  resolveAvailableStock,
  validateOrderStock,
  validateRequestedStock,
};
