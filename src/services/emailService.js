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

const buildCustomerOrderDetailUrl = ({ orderId, baseUrl }) => {
  const encodedOrderId = encodeURIComponent(orderId);
  if (!baseUrl) return `/#order-detail?id=${encodedOrderId}`;
  const trimmedBase = String(baseUrl).replace(/\/+$/, '');
  return `${trimmedBase}/#order-detail?id=${encodedOrderId}`;
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


const buildCustomerOrderPaidEmail = ({ order, items = [], orderDetailUrl }) => {
  const customerName = order.recipient_name || order.user_name || 'Nainara Customer';
  const paymentStatus = order.status || 'paid';
  const shippingAddress = order.shipping_address || '-';
  const itemRows = items.map((item) => {
    const itemName = item.product_name || item.name || `Product #${item.product_id || '-'}`;
    const quantity = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    const subtotal = quantity * price;
    return `
      <tr>
        <td style="padding:14px 12px;border-bottom:1px solid #eadfd7;vertical-align:top;">
          <div style="font-weight:700;color:#3b2f2f;">${escapeHtml(itemName)}</div>
          <div style="margin-top:4px;font-size:12px;color:#8a786d;">Size: ${escapeHtml(item.size || '-')} &nbsp;|&nbsp; Color: ${escapeHtml(item.color || '-')}</div>
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #eadfd7;text-align:center;vertical-align:top;">${escapeHtml(quantity)}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #eadfd7;text-align:right;vertical-align:top;font-weight:700;">${escapeHtml(formatCurrency(subtotal))}</td>
      </tr>`;
  }).join('') || `
      <tr>
        <td colspan="3" style="padding:14px 12px;border-bottom:1px solid #eadfd7;">No item details available.</td>
      </tr>`;

  const textItems = items.length
    ? items.map((item) => {
      const itemName = item.product_name || item.name || `Product #${item.product_id || '-'}`;
      const quantity = Number(item.quantity || 0);
      const subtotal = quantity * Number(item.price || 0);
      return `- ${itemName} | Qty: ${quantity} | Size: ${item.size || '-'} | Color: ${item.color || '-'} | Subtotal: ${formatCurrency(subtotal)}`;
    })
    : ['- No item details available.'];

  const htmlContent = `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <title>Payment confirmed for order #${escapeHtml(order.id)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f8f3ef;font-family:Arial,Helvetica,sans-serif;color:#3b2f2f;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Thank you for your Nainara Boutique order. Your payment has been confirmed.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8f3ef;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fffdf9;border:1px solid #eadfd7;border-radius:18px;overflow:hidden;border-collapse:separate;">
            <tr>
              <td style="background:#8b5e3c;padding:28px 24px;text-align:center;color:#ffffff;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:1.6px;font-weight:700;">Nainara Boutique</div>
                <div style="margin-top:8px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#f6eadf;">Payment Confirmed</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px;">
                <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#3b2f2f;">Thank you, ${escapeHtml(customerName)}.</h1>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#5f5048;">We have received your payment and are preparing your order with care. Below is your confirmation summary.</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#fbf6ef;border:1px solid #eadfd7;border-radius:14px;margin:0 0 22px;">
                  <tr><td style="padding:14px 16px;color:#8a786d;width:42%;">Order ID</td><td style="padding:14px 16px;font-weight:700;text-align:right;">#${escapeHtml(order.id)}</td></tr>
                  <tr><td style="padding:0 16px 14px;color:#8a786d;">Payment Status</td><td style="padding:0 16px 14px;font-weight:700;text-align:right;text-transform:capitalize;color:#6f4b31;">${escapeHtml(paymentStatus)}</td></tr>
                  <tr><td style="padding:0 16px 16px;color:#8a786d;">Payment Amount</td><td style="padding:0 16px 16px;font-size:18px;font-weight:700;text-align:right;color:#3b2f2f;">${escapeHtml(formatCurrency(order.total_amount))}</td></tr>
                </table>

                <h2 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#3b2f2f;">Order items</h2>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #eadfd7;border-radius:12px;overflow:hidden;margin:0 0 22px;background:#ffffff;">
                  <thead>
                    <tr style="background:#f3e8df;color:#5f5048;">
                      <th align="left" style="padding:12px;font-size:13px;">Product</th>
                      <th align="center" style="padding:12px;font-size:13px;">Qty</th>
                      <th align="right" style="padding:12px;font-size:13px;">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>${itemRows}
                  </tbody>
                </table>

                <h2 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#3b2f2f;">Shipping address</h2>
                <p style="margin:0 0 24px;padding:14px 16px;background:#fbf6ef;border:1px solid #eadfd7;border-radius:12px;font-size:14px;line-height:1.7;white-space:pre-line;color:#5f5048;">${escapeHtml(shippingAddress)}</p>

                <div style="text-align:center;margin:28px 0 10px;">
                  <a href="${escapeHtml(orderDetailUrl)}" style="display:inline-block;background:#8b5e3c;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:999px;font-weight:700;font-size:14px;">View order details</a>
                </div>
                <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#8a786d;text-align:center;">If the button does not work, open this link: <br><span style="word-break:break-all;">${escapeHtml(orderDetailUrl)}</span></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textContent = [
    'Nainara Boutique - Payment Confirmed',
    `Thank you, ${customerName}. We have received your payment and are preparing your order.`,
    `Order ID: #${order.id}`,
    `Payment status: ${paymentStatus}`,
    `Payment amount: ${formatCurrency(order.total_amount)}`,
    'Items:',
    ...textItems,
    `Shipping address: ${shippingAddress}`,
    `Order detail: ${orderDetailUrl}`,
  ].join('\n');

  return {
    subject: `Payment confirmed for order #${order.id}`,
    htmlContent,
    textContent,
  };
};

const sendCustomerOrderPaidConfirmation = async ({ to, order, items, orderDetailUrl, env = process.env, fetchImpl }) => {
  const email = buildCustomerOrderPaidEmail({ order, items, orderDetailUrl });
  return sendTransactionalEmail({
    to,
    subject: email.subject,
    htmlContent: email.htmlContent,
    textContent: email.textContent,
    env,
    fetchImpl,
  });
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
  buildCustomerOrderDetailUrl,
  buildCustomerOrderPaidEmail,
  escapeHtml,
  formatCurrency,
  getMissingEmailEnv,
  sendAdminOrderPaidNotification,
  sendCustomerOrderPaidConfirmation,
  sendTransactionalEmail,
};
