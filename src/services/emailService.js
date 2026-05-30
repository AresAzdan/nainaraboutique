const BREVO_SEND_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';

const requiredEmailEnv = [
  'BREVO_API_KEY',
  'ADMIN_NOTIFICATION_EMAIL',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
];

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
};

const getMissingEmailEnv = (env = process.env) => requiredEmailEnv.filter((key) => !env[key]);

const normalizeItemVariant = (item) => {
  const details = [item.size, item.color].filter(Boolean).map(String);
  return details.length ? details.join(' / ') : '-';
};

const buildAdminOrderDetailUrl = ({ orderId, baseUrl }) => {
  if (!baseUrl) return `/api/admin/orders/${encodeURIComponent(orderId)}`;
  const trimmedBase = String(baseUrl).replace(/\/+$/, '');
  return `${trimmedBase}/api/admin/orders/${encodeURIComponent(orderId)}`;
};

const buildAdminOrderPaidEmail = ({ order, items = [], adminOrderDetailUrl }) => {
  const customerName = order.recipient_name || order.user_name || 'Customer';
  const customerPhone = order.phone || '-';
  const paymentMethod = order.payment_method || order.payment_type || order.midtrans_payment_type || '-';
  const shippingAddress = order.shipping_address || '-';
  const itemRows = items.map((item) => {
    const itemName = item.product_name || item.name || `Product #${item.product_id || '-'}`;
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eadfd7;">${escapeHtml(itemName)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eadfd7;text-align:center;">${escapeHtml(item.quantity)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eadfd7;">${escapeHtml(normalizeItemVariant(item))}</td>
      </tr>`;
  }).join('') || `
      <tr>
        <td colspan="3" style="padding:10px 12px;border-bottom:1px solid #eadfd7;">No item details available.</td>
      </tr>`;

  const htmlContent = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8f3ef;font-family:Arial,Helvetica,sans-serif;color:#3b2f2f;">
    <div style="max-width:680px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #eadfd7;">
        <div style="background:#8b5e3c;color:#ffffff;padding:24px;">
          <h1 style="margin:0;font-size:24px;line-height:1.3;">New Paid Order</h1>
          <p style="margin:8px 0 0;font-size:14px;opacity:.9;">Order #${escapeHtml(order.id)} is ready for admin review.</p>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">A customer payment has been successfully confirmed. Please review the order details and prepare fulfillment.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 20px;">
            <tr><td style="padding:8px 0;color:#7a6a61;width:180px;">Order ID</td><td style="padding:8px 0;font-weight:700;">${escapeHtml(order.id)}</td></tr>
            <tr><td style="padding:8px 0;color:#7a6a61;">Customer</td><td style="padding:8px 0;">${escapeHtml(customerName)}</td></tr>
            <tr><td style="padding:8px 0;color:#7a6a61;">Phone</td><td style="padding:8px 0;">${escapeHtml(customerPhone)}</td></tr>
            <tr><td style="padding:8px 0;color:#7a6a61;">Total Payment</td><td style="padding:8px 0;font-weight:700;">${escapeHtml(formatCurrency(order.total_amount))}</td></tr>
            <tr><td style="padding:8px 0;color:#7a6a61;">Payment Method</td><td style="padding:8px 0;">${escapeHtml(paymentMethod)}</td></tr>
            <tr><td style="padding:8px 0;color:#7a6a61;vertical-align:top;">Shipping Address</td><td style="padding:8px 0;white-space:pre-line;">${escapeHtml(shippingAddress)}</td></tr>
          </table>
          <h2 style="font-size:18px;margin:0 0 12px;">Items</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #eadfd7;border-radius:10px;overflow:hidden;margin-bottom:24px;">
            <thead>
              <tr style="background:#f3e8df;">
                <th align="left" style="padding:10px 12px;">Item</th>
                <th align="center" style="padding:10px 12px;">Qty</th>
                <th align="left" style="padding:10px 12px;">Size / Color</th>
              </tr>
            </thead>
            <tbody>${itemRows}
            </tbody>
          </table>
          <a href="${escapeHtml(adminOrderDetailUrl)}" style="display:inline-block;background:#8b5e3c;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">Open admin order detail</a>
        </div>
      </div>
    </div>
  </body>
</html>`;

  const textContent = [
    `New paid order #${order.id}`,
    `Customer: ${customerName}`,
    `Phone: ${customerPhone}`,
    `Total payment: ${formatCurrency(order.total_amount)}`,
    `Payment method: ${paymentMethod}`,
    `Shipping address: ${shippingAddress}`,
    'Items:',
    ...items.map((item) => {
      const itemName = item.product_name || item.name || `Product #${item.product_id || '-'}`;
      return `- ${itemName} | Qty: ${item.quantity} | Size/Color: ${normalizeItemVariant(item)}`;
    }),
    `Admin order detail: ${adminOrderDetailUrl}`,
  ].join('\n');

  return {
    subject: `New paid order #${order.id}`,
    htmlContent,
    textContent,
  };
};

const sendTransactionalEmail = async ({ to, subject, htmlContent, textContent, env = process.env, fetchImpl = globalThis.fetch }) => {
  const missingEnv = getMissingEmailEnv(env);
  if (missingEnv.length) {
    throw new Error(`Missing Brevo email environment variables: ${missingEnv.join(', ')}`);
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation is available for Brevo email delivery');
  }

  const response = await fetchImpl(BREVO_SEND_EMAIL_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: {
        email: env.EMAIL_FROM,
        name: env.EMAIL_FROM_NAME,
      },
      to: [{ email: to }],
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    throw new Error(`Brevo transactional email failed with HTTP ${response.status}: ${responseBody}`);
  }

  return response.json().catch(() => ({}));
};

const sendAdminOrderPaidNotification = async ({ order, items, adminOrderDetailUrl, env = process.env, fetchImpl }) => {
  const email = buildAdminOrderPaidEmail({ order, items, adminOrderDetailUrl });
  return sendTransactionalEmail({
    to: env.ADMIN_NOTIFICATION_EMAIL,
    subject: email.subject,
    htmlContent: email.htmlContent,
    textContent: email.textContent,
    env,
    fetchImpl,
  });
};

module.exports = {
  BREVO_SEND_EMAIL_URL,
  buildAdminOrderDetailUrl,
  buildAdminOrderPaidEmail,
  escapeHtml,
  formatCurrency,
  getMissingEmailEnv,
  sendAdminOrderPaidNotification,
  sendTransactionalEmail,
};
