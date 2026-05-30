const assert = require('assert');
const {
  buildPricedOrderItems,
  calculateOrderTotal,
  buildMidtransSnapPayload,
} = require('../src/utils/orderPricing');

const clientItemsWithUntrustedPrices = [
  { product_id: 101, product_name: 'Fake Client Name', quantity: 2, price: 1, size: 'L', color: 'Brown' },
  { product_id: 202, quantity: 1, price: 1, color: 'Ivory' },
];

const authoritativePricingSnapshots = new Map([
  [101, { id: 101, name: 'Cheesy Dress', final_price: 125000 }],
  [202, { id: 202, name: 'Pearl Brooch', final_price: 50000 }],
]);

const pricedItems = buildPricedOrderItems(clientItemsWithUntrustedPrices, authoritativePricingSnapshots);
const grossAmount = calculateOrderTotal({
  items: pricedItems,
  shippingCost: 15000,
  discountAmount: 10000,
});

const payload = buildMidtransSnapPayload({
  orderId: 'NAINARA-TEST-1',
  grossAmount,
  items: pricedItems,
  shippingCost: 15000,
  discountAmount: 10000,
  customer: {
    firstName: 'Nadia Customer',
    email: 'nadia@example.test',
    phone: '+628123456789',
    shippingAddress: 'Jl. Melati 1, Bandung, 40111',
  },
});

assert.deepStrictEqual(payload.transaction_details, {
  order_id: 'NAINARA-TEST-1',
  gross_amount: 305000,
});

assert.deepStrictEqual(payload.item_details, [
  { id: '101', name: 'Cheesy Dress - L / Brown', quantity: 2, price: 125000 },
  { id: '202', name: 'Pearl Brooch - Ivory', quantity: 1, price: 50000 },
  { id: 'SHIPPING', name: 'Shipping Fee', quantity: 1, price: 15000 },
  { id: 'DISCOUNT', name: 'Discount', quantity: 1, price: -10000 },
]);

assert.deepStrictEqual(payload.customer_details, {
  first_name: 'Nadia Customer',
  email: 'nadia@example.test',
  phone: '+628123456789',
  shipping_address: {
    first_name: 'Nadia Customer',
    phone: '+628123456789',
    address: 'Jl. Melati 1, Bandung, 40111',
  },
});

const itemDetailsTotal = payload.item_details.reduce(
  (sum, item) => sum + item.price * item.quantity,
  0
);

assert.strictEqual(itemDetailsTotal, payload.transaction_details.gross_amount);
assert.strictEqual(payload.item_details[0].price, 125000, 'item_details must use backend-authoritative price, not client-sent price');

assert.throws(
  () => buildMidtransSnapPayload({
    orderId: 'NAINARA-TEST-MISMATCH',
    grossAmount: grossAmount + 1,
    items: pricedItems,
    shippingCost: 15000,
    discountAmount: 10000,
    customer: { firstName: 'Nadia Customer' },
  }),
  /must equal gross_amount/,
  'Midtrans payload builder must reject item_details totals that do not equal gross_amount'
);

console.log('midtrans payload regression checks passed');
