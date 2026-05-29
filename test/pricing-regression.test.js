const assert = require('assert');
const { buildProductPricingFields } = require('../src/utils/pricing');
const { buildPricedOrderItems, calculateOrderTotal } = require('../src/utils/orderPricing');

const pricing = buildProductPricingFields(850000, 10);
assert.strictEqual(pricing.price, 850000, 'API price must remain the base/original product price');
assert.strictEqual(pricing.base_price, 850000, 'base_price must expose the base/original product price');
assert.strictEqual(pricing.original_price, 850000, 'original_price must expose the crossed-out original price when discounted');
assert.strictEqual(pricing.final_price, 765000, '10% discount on 850000 must produce final_price 765000');
assert.strictEqual(pricing.discount_percent, 10, 'discount_percent must expose the active discount percentage');

const undiscounted = buildProductPricingFields(850000, null);
assert.strictEqual(undiscounted.price, 850000, 'Undiscounted API price must remain the base/original product price');
assert.strictEqual(undiscounted.original_price, 850000, 'original_price must be present as the base/original product price');
assert.strictEqual(undiscounted.final_price, 850000, 'No discount must keep final_price equal to base price');

const maliciousClientItems = [
  { product_id: 1, product_name: 'Cheesy Dress', quantity: 1, price: 557685 },
];
const authoritativeSnapshots = new Map([
  [1, { id: 1, name: 'Cheesy Dress', base_price: 850000, final_price: 765000, discount_percent: 10 }],
]);
const pricedItems = buildPricedOrderItems(maliciousClientItems, authoritativeSnapshots);

assert.strictEqual(pricedItems[0].price, 765000, 'Backend order pricing must ignore client-sent item.price');
assert.strictEqual(
  calculateOrderTotal({ items: pricedItems, shippingCost: 0, discountAmount: 0 }),
  765000,
  'Backend-computed order total must use the authoritative final unit price'
);

console.log('pricing regression checks passed');
