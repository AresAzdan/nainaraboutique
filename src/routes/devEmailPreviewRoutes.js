const express = require('express');
const {
  buildAdminOrderDetailUrl,
  buildAdminOrderPaidEmail,
  buildAdminRefundRequestEmail,
  buildCustomerOrderDetailUrl,
  buildCustomerOrderPaidEmail,
  buildCustomerOrderShippedEmail,
  buildCustomerRefundStatusEmail,
  escapeHtml,
} = require('../services/emailService');

const router = express.Router();

const previewTypes = [
  {
    type: 'paid',
    label: 'Customer paid order email',
    build: ({ order, items, customerOrderDetailUrl }) => buildCustomerOrderPaidEmail({
      order,
      items,
      orderDetailUrl: customerOrderDetailUrl,
    }),
  },
  {
    type: 'refund-request',
    label: 'Customer refund request email',
    build: ({ order, items, customerOrderDetailUrl }) => buildCustomerRefundStatusEmail({
      order: {
        ...order,
        refund_status: 'requested',
        refund_reason: 'Wrong size received; customer requested a smaller size.',
      },
      items,
      orderDetailUrl: customerOrderDetailUrl,
      status: 'requested',
    }),
  },
  {
    type: 'refund-approved',
    label: 'Customer refund approved email',
    build: ({ order, items, customerOrderDetailUrl }) => buildCustomerRefundStatusEmail({
      order: {
        ...order,
        refund_status: 'refunded',
        refund_reason: 'Refund approved by admin after quality review.',
      },
      items,
      orderDetailUrl: customerOrderDetailUrl,
      status: 'refunded',
    }),
  },
  {
    type: 'refund-rejected',
    label: 'Customer refund rejected email',
    build: ({ order, items, customerOrderDetailUrl }) => buildCustomerRefundStatusEmail({
      order: {
        ...order,
        refund_status: 'rejected',
        refund_midtrans_response: { rejection_reason: 'Return window has expired for this order.' },
      },
      items,
      orderDetailUrl: customerOrderDetailUrl,
      status: 'rejected',
    }),
  },
  {
    type: 'shipped',
    label: 'Customer shipped order email',
    build: ({ order, items, customerOrderDetailUrl }) => buildCustomerOrderShippedEmail({
      order: {
        ...order,
        status: 'shipped',
        tracking_courier: 'JNE',
        tracking_number: 'NB-DEV-123456789',
      },
      items,
      orderDetailUrl: customerOrderDetailUrl,
    }),
  },
  {
    type: 'admin-paid',
    label: 'Admin paid order notification',
    build: ({ order, items, adminOrderDetailUrl }) => buildAdminOrderPaidEmail({
      order,
      items,
      adminOrderDetailUrl,
    }),
  },
  {
    type: 'admin-refund-request',
    label: 'Admin refund request notification',
    build: ({ order, items, adminOrderDetailUrl }) => buildAdminRefundRequestEmail({
      order: {
        ...order,
        refund_status: 'requested',
        refund_reason: 'Wrong size received; customer requested a smaller size.',
      },
      items,
      adminOrderDetailUrl,
    }),
  },
];

const previewAliases = new Map([
  ['refund', 'refund-request'],
  ['refund_requested', 'refund-request'],
  ['refund-requested', 'refund-request'],
  ['approved', 'refund-approved'],
  ['refund_approved', 'refund-approved'],
  ['rejected', 'refund-rejected'],
  ['refund_rejected', 'refund-rejected'],
  ['admin_paid', 'admin-paid'],
  ['admin-refund', 'admin-refund-request'],
  ['admin_refund_request', 'admin-refund-request'],
]);

const previewTypeMap = new Map(previewTypes.map((preview) => [preview.type, preview]));

const createMockEmailPreviewData = ({ baseUrl = 'http://localhost:3000' } = {}) => {
  const order = {
    id: 'DEV-ORDER-1001',
    recipient_name: 'Nadia Preview',
    user_name: 'Nadia Preview',
    customer_email: 'nadia.preview@example.test',
    user_email: 'nadia.preview@example.test',
    phone: '+62 812-3456-7890',
    total_amount: 635000,
    payment_method: 'bank_transfer',
    payment_type: 'bank_transfer',
    midtrans_payment_type: 'bank_transfer',
    shipping_address: 'Jl. Melati No. 12\nBandung, Jawa Barat 40111\nIndonesia',
    status: 'paid',
    refund_amount: 225000,
    refund_reason: 'Wrong size received; customer requested a smaller size.',
    refund_status: 'requested',
    tracking_courier: 'JNE',
    tracking_number: 'NB-DEV-123456789',
  };

  const items = [
    {
      product_id: 101,
      product_name: 'Aurelia Linen Dress',
      name: 'Aurelia Linen Dress',
      quantity: 1,
      price: 385000,
      size: 'M',
      color: 'Sage',
    },
    {
      product_id: 202,
      product_name: 'Pearl Embroidered Hijab',
      name: 'Pearl Embroidered Hijab',
      quantity: 2,
      price: 125000,
      size: 'One Size',
      color: 'Ivory',
    },
  ];

  return {
    order,
    items,
    customerOrderDetailUrl: buildCustomerOrderDetailUrl({ orderId: order.id, baseUrl }),
    adminOrderDetailUrl: buildAdminOrderDetailUrl({ orderId: order.id, baseUrl }),
  };
};

const normalizePreviewType = (type) => {
  const normalized = String(type || '').trim().toLowerCase();
  return previewAliases.get(normalized) || normalized;
};

const buildPreviewIndexHtml = ({ selectedType } = {}) => {
  const links = previewTypes.map(({ type, label }) => `
        <li><a href="/dev/email-preview?type=${encodeURIComponent(type)}">${escapeHtml(label)}</a> <code>${escapeHtml(type)}</code></li>`).join('');
  const selectedMessage = selectedType
    ? `<p class="error">Unknown preview type: <code>${escapeHtml(selectedType)}</code></p>`
    : '<p>Select a transactional email template to render its raw HTML preview.</p>';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Nainara Dev Email Preview</title>
    <style>
      body { margin: 0; padding: 32px; background: #FAF8F5; color: #3b332c; font-family: Arial, Helvetica, sans-serif; }
      main { max-width: 760px; margin: 0 auto; background: #fffdf9; border: 1px solid #ebe4da; border-radius: 16px; padding: 28px; }
      h1 { margin-top: 0; font-family: Georgia, 'Times New Roman', serif; }
      li { margin: 12px 0; }
      a { color: #5D5340; font-weight: 700; }
      code { background: #ebe4da; border-radius: 6px; padding: 2px 6px; }
      .error { color: #9f2f2f; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Nainara Dev Email Preview</h1>
      ${selectedMessage}
      <ul>${links}
      </ul>
    </main>
  </body>
</html>`;
};

const buildEmailPreview = ({ type, baseUrl } = {}) => {
  const normalizedType = normalizePreviewType(type);
  const preview = previewTypeMap.get(normalizedType);
  if (!preview) return null;

  const previewData = createMockEmailPreviewData({ baseUrl });
  return {
    type: preview.type,
    label: preview.label,
    email: preview.build(previewData),
  };
};

router.get('/', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');

  if (!req.query.type) {
    res.type('html').send(buildPreviewIndexHtml());
    return;
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const preview = buildEmailPreview({ type: req.query.type, baseUrl });
  if (!preview) {
    res.status(404).type('html').send(buildPreviewIndexHtml({ selectedType: req.query.type }));
    return;
  }

  res.type('html').send(preview.email.htmlContent);
});

module.exports = {
  buildEmailPreview,
  buildPreviewIndexHtml,
  createMockEmailPreviewData,
  previewTypes,
  router,
};
