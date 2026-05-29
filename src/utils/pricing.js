function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function calculateFinalPrice(basePrice, discountPercent) {
  const base = toNumber(basePrice, 0);
  const pct = toNumber(discountPercent, 0);
  if (pct <= 0) return base;
  return Math.round(base * (1 - pct / 100));
}

function buildProductPricingFields(basePrice, discountPercent) {
  const base = toNumber(basePrice, 0);
  const pct = toNumber(discountPercent, 0) || null;
  const finalPrice = calculateFinalPrice(base, pct);

  return {
    price: base,
    base_price: base,
    original_price: base,
    final_price: finalPrice,
    discount: pct ? `${pct}%` : null,
    discount_percent: pct,
  };
}

module.exports = {
  calculateFinalPrice,
  buildProductPricingFields,
};
