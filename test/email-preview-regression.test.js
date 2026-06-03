const assert = require('assert');
const {
  buildEmailPreview,
  buildPreviewIndexHtml,
  createMockEmailPreviewData,
  previewTypes,
} = require('../src/routes/devEmailPreviewRoutes');

const previewTypeNames = previewTypes.map(({ type }) => type);
assert.deepStrictEqual(previewTypeNames, [
  'paid',
  'refund-request',
  'refund-approved',
  'refund-rejected',
  'shipped',
  'admin-paid',
  'admin-refund-request',
]);

const mockData = createMockEmailPreviewData({ baseUrl: 'http://localhost:3000' });
assert.strictEqual(mockData.order.id, 'DEV-ORDER-1001');
assert.strictEqual(mockData.order.customer_email, 'nadia.preview@example.test');
assert.strictEqual(mockData.items.length, 2);
assert.strictEqual(mockData.customerOrderDetailUrl, 'http://localhost:3000/#order-detail?id=DEV-ORDER-1001');
assert.strictEqual(mockData.adminOrderDetailUrl, 'http://localhost:3000/api/admin/orders/DEV-ORDER-1001');

for (const type of previewTypeNames) {
  const preview = buildEmailPreview({ type, baseUrl: 'http://localhost:3000' });
  assert.ok(preview, `${type} preview should be available`);
  assert.strictEqual(preview.type, type);
  assert.ok(preview.email.subject, `${type} preview should include a subject`);
  assert.ok(preview.email.htmlContent.startsWith('<!doctype html>'), `${type} preview should render raw email HTML`);
  assert.ok(preview.email.htmlContent.includes('email-shell'), `${type} preview should use existing responsive email template output`);
  assert.ok(preview.email.textContent, `${type} preview should include text content from the existing builder`);
}

assert.strictEqual(
  buildEmailPreview({ type: 'refund_approved', baseUrl: 'http://localhost:3000' }).type,
  'refund-approved'
);
assert.strictEqual(buildEmailPreview({ type: 'not-a-real-preview', baseUrl: 'http://localhost:3000' }), null);

const indexHtml = buildPreviewIndexHtml();
assert.ok(indexHtml.includes('/dev/email-preview?type=paid'));
assert.ok(indexHtml.includes('/dev/email-preview?type=shipped'));
assert.ok(indexHtml.includes('Admin refund request notification'));

console.log('email preview regression checks passed');
