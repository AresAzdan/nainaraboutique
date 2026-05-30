const assert = require('assert');
const {
  BREVO_SEND_EMAIL_URL,
  buildAdminOrderDetailUrl,
  buildAdminOrderPaidEmail,
  buildCustomerOrderDetailUrl,
  buildCustomerOrderPaidEmail,
  getMissingEmailEnv,
  sendAdminOrderPaidNotification,
  sendCustomerOrderPaidConfirmation,
} = require('../src/services/emailService');

const env = {
  BREVO_API_KEY: 'test-brevo-api-key',
  ADMIN_NOTIFICATION_EMAIL: 'admin@example.test',
  EMAIL_FROM: 'orders@example.test',
  EMAIL_FROM_NAME: 'Nainara Boutique Test',
};

assert.deepStrictEqual(getMissingEmailEnv(env), []);
assert.deepStrictEqual(getMissingEmailEnv({ ...env, BREVO_API_KEY: '' }), ['BREVO_API_KEY']);
assert.strictEqual(
  buildAdminOrderDetailUrl({ orderId: 42, baseUrl: 'https://api.example.test/' }),
  'https://api.example.test/api/admin/orders/42'
);
assert.strictEqual(
  buildCustomerOrderDetailUrl({ orderId: 42, baseUrl: 'https://nainaraboutique.example/' }),
  'https://nainaraboutique.example/#order-detail?id=42'
);

const order = {
  id: 42,
  recipient_name: 'Nadia <Admin>',
  user_name: 'Nadia User',
  phone: '+628123456789',
  total_amount: '305000.00',
  payment_method: 'bank_transfer',
  shipping_address: 'Jl. Melati 1\nBandung',
  status: 'paid',
  customer_email: 'nadia@example.test',
};
const items = [
  { product_id: 101, product_name: 'Cheesy Dress', quantity: 2, price: 125000, size: 'L', color: 'Brown' },
  { product_id: 202, product_name: 'Pearl Brooch', quantity: 1, price: 50000, size: null, color: 'Ivory' },
];

const builtEmail = buildAdminOrderPaidEmail({
  order,
  items,
  adminOrderDetailUrl: 'https://api.example.test/api/admin/orders/42',
});
assert.strictEqual(builtEmail.subject, 'New paid order #42');
assert.ok(builtEmail.htmlContent.includes('Nadia &lt;Admin&gt;'), 'HTML email must escape customer-controlled text');
assert.ok(builtEmail.htmlContent.includes('Cheesy Dress'));
assert.ok(builtEmail.textContent.includes('Qty: 2 | Size/Color: L / Brown'));
assert.ok(builtEmail.textContent.includes('Rp\u00a0305.000'));

const builtCustomerEmail = buildCustomerOrderPaidEmail({
  order,
  items,
  orderDetailUrl: 'https://nainaraboutique.example/#order-detail?id=42',
});
assert.strictEqual(builtCustomerEmail.subject, 'Payment confirmed for order #42');
assert.ok(builtCustomerEmail.htmlContent.includes('Nainara Boutique'));
assert.ok(builtCustomerEmail.htmlContent.includes('Payment Confirmed'));
assert.ok(builtCustomerEmail.htmlContent.includes('Nadia &lt;Admin&gt;'), 'Customer HTML email must escape recipient text');
assert.ok(builtCustomerEmail.htmlContent.includes('Rp 250.000'), 'Customer HTML email must include item subtotals');
assert.ok(builtCustomerEmail.textContent.includes('Payment status: paid'));
assert.ok(builtCustomerEmail.textContent.includes('Size: L | Color: Brown | Subtotal: Rp 250.000'));
assert.ok(builtCustomerEmail.textContent.includes('Order detail: https://nainaraboutique.example/#order-detail?id=42'));

let capturedRequest;
const fakeFetch = async (url, options) => {
  capturedRequest = { url, options };
  return {
    ok: true,
    status: 201,
    json: async () => ({ messageId: '<test-message-id@example.test>' }),
  };
};

sendAdminOrderPaidNotification({
  order,
  items,
  adminOrderDetailUrl: 'https://api.example.test/api/admin/orders/42',
  env,
  fetchImpl: fakeFetch,
}).then((response) => {
  assert.deepStrictEqual(response, { messageId: '<test-message-id@example.test>' });
  assert.strictEqual(capturedRequest.url, BREVO_SEND_EMAIL_URL);
  assert.strictEqual(capturedRequest.options.method, 'POST');
  assert.strictEqual(capturedRequest.options.headers['api-key'], env.BREVO_API_KEY);

  const payload = JSON.parse(capturedRequest.options.body);
  assert.deepStrictEqual(payload.sender, { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME });
  assert.deepStrictEqual(payload.to, [{ email: env.ADMIN_NOTIFICATION_EMAIL }]);
  assert.strictEqual(payload.subject, 'New paid order #42');
  assert.ok(payload.htmlContent.includes('Open admin order detail'));
  assert.ok(payload.textContent.includes('Admin order detail: https://api.example.test/api/admin/orders/42'));

  return sendCustomerOrderPaidConfirmation({
    to: order.customer_email,
    order,
    items,
    orderDetailUrl: 'https://nainaraboutique.example/#order-detail?id=42',
    env,
    fetchImpl: fakeFetch,
  });
}).then((response) => {
  assert.deepStrictEqual(response, { messageId: '<test-message-id@example.test>' });
  const payload = JSON.parse(capturedRequest.options.body);
  assert.deepStrictEqual(payload.to, [{ email: order.customer_email }]);
  assert.strictEqual(payload.subject, 'Payment confirmed for order #42');
  assert.ok(payload.htmlContent.includes('View order details'));
  assert.ok(payload.textContent.includes('Nainara Boutique - Payment Confirmed'));

  return sendAdminOrderPaidNotification({
    order,
    items,
    adminOrderDetailUrl: 'https://api.example.test/api/admin/orders/42',
    env: { ...env, ADMIN_NOTIFICATION_EMAIL: '' },
    fetchImpl: fakeFetch,
  }).then(
    () => assert.fail('expected missing env rejection'),
    (err) => assert.match(err.message, /ADMIN_NOTIFICATION_EMAIL/)
  );
}).then(() => {
  console.log('email service regression checks passed');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
