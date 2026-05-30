const assert = require('assert');
const {
  BREVO_SEND_EMAIL_URL,
  buildAdminOrderDetailUrl,
  buildAdminOrderPaidEmail,
  buildAdminRefundRequestEmail,
  buildCustomerOrderCancelledEmail,
  buildCustomerOrderDetailUrl,
  buildCustomerOrderPaidEmail,
  buildCustomerOrderShippedEmail,
  buildCustomerRefundStatusEmail,
  getMissingEmailEnv,
  sendAdminOrderPaidNotification,
  sendAdminRefundRequestNotification,
  sendCustomerOrderPaidConfirmation,
  sendCustomerOrderShippedEmail,
  sendCustomerRefundStatusEmail,
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

const builtRefundRequestedEmail = buildCustomerRefundStatusEmail({
  order: { ...order, refund_status: 'requested', refund_amount: '125000.00', refund_reason: 'Wrong size <ordered>' },
  items,
  status: 'requested',
  orderDetailUrl: 'https://nainaraboutique.example/#order-detail?id=42',
});
assert.strictEqual(builtRefundRequestedEmail.subject, 'Refund request received for order #42');
assert.ok(builtRefundRequestedEmail.htmlContent.includes('Wrong size &lt;ordered&gt;'));
assert.ok(builtRefundRequestedEmail.textContent.includes('Refund status: requested'));
assert.ok(builtRefundRequestedEmail.textContent.includes('Refund amount: Rp\u00a0125.000'));

const builtRefundRejectedEmail = buildCustomerRefundStatusEmail({
  order: { ...order, refund_status: 'rejected', refund_amount: '125000.00', refund_midtrans_response: { rejection_reason: 'Outside policy window' } },
  items,
  status: 'rejected',
  orderDetailUrl: 'https://nainaraboutique.example/#order-detail?id=42',
});
assert.strictEqual(builtRefundRejectedEmail.subject, 'Refund request update for order #42');
assert.ok(builtRefundRejectedEmail.textContent.includes('Rejection reason: Outside policy window'));

const builtCancelledEmail = buildCustomerOrderCancelledEmail({
  order,
  items,
  orderDetailUrl: 'https://nainaraboutique.example/#order-detail?id=42',
});
assert.strictEqual(builtCancelledEmail.subject, 'Order #42 has been cancelled');
assert.ok(builtCancelledEmail.textContent.includes('has been cancelled'));

const builtShippedEmail = buildCustomerOrderShippedEmail({
  order: { ...order, tracking_courier: 'JNE', tracking_number: 'JP1234567890' },
  items,
  orderDetailUrl: 'https://nainaraboutique.example/#order-detail?id=42',
});
assert.strictEqual(builtShippedEmail.subject, 'Order #42 is on the way');
assert.ok(builtShippedEmail.textContent.includes('Courier: JNE'));
assert.ok(builtShippedEmail.textContent.includes('Tracking number: JP1234567890'));

const builtAdminRefundEmail = buildAdminRefundRequestEmail({
  order: { ...order, refund_reason: 'Damaged item' },
  items,
  adminOrderDetailUrl: 'https://api.example.test/api/admin/orders/42',
});
assert.strictEqual(builtAdminRefundEmail.subject, 'Refund request for order #42');
assert.ok(builtAdminRefundEmail.textContent.includes('Email: nadia@example.test'));
assert.ok(builtAdminRefundEmail.textContent.includes('Phone: +628123456789'));
assert.ok(builtAdminRefundEmail.textContent.includes('Refund reason: Damaged item'));

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

  return sendCustomerOrderShippedEmail({
    to: order.customer_email,
    order: { ...order, tracking_courier: 'JNE', tracking_number: 'JP1234567890' },
    items,
    orderDetailUrl: 'https://nainaraboutique.example/#order-detail?id=42',
    env,
    fetchImpl: fakeFetch,
  });
}).then(() => {
  let payload = JSON.parse(capturedRequest.options.body);
  assert.strictEqual(payload.subject, 'Order #42 is on the way');
  assert.ok(payload.textContent.includes('Tracking number: JP1234567890'));

  return sendCustomerRefundStatusEmail({
    to: order.customer_email,
    order: { ...order, refund_status: 'refunded', refund_amount: '125000.00', refund_reason: 'Damaged item' },
    items,
    status: 'refunded',
    orderDetailUrl: 'https://nainaraboutique.example/#order-detail?id=42',
    env,
    fetchImpl: fakeFetch,
  });
}).then(() => {
  let payload = JSON.parse(capturedRequest.options.body);
  assert.strictEqual(payload.subject, 'Refund approved for order #42');
  assert.ok(payload.textContent.includes('Refund status: refunded'));

  return sendAdminRefundRequestNotification({
    order: { ...order, refund_reason: 'Damaged item' },
    items,
    adminOrderDetailUrl: 'https://api.example.test/api/admin/orders/42',
    env,
    fetchImpl: fakeFetch,
  });
}).then(() => {
  const payload = JSON.parse(capturedRequest.options.body);
  assert.deepStrictEqual(payload.to, [{ email: env.ADMIN_NOTIFICATION_EMAIL }]);
  assert.strictEqual(payload.subject, 'Refund request for order #42');

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
