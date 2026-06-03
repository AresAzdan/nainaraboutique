const BREVO_SEND_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';

const requiredEmailEnv = [
  'BREVO_API_KEY',
  'ADMIN_NOTIFICATION_EMAIL',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
];

const buildEmailHead = (title) => `
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <title>${escapeHtml(title)}</title>
    <style>
      @media only screen and (max-width: 600px) {
        .email-shell { width: 100% !important; max-width: 600px !important; }
        .outer-pad { padding: 14px 10px !important; }
        .header-pad { padding: 22px 18px !important; }
        .content-pad { padding: 22px 16px !important; }
        .brand-title { font-size: 24px !important; line-height: 1.2 !important; }
        .email-title { font-size: 21px !important; line-height: 1.3 !important; margin-bottom: 10px !important; }
        .section-title { font-size: 18px !important; }
        .summary-label, .summary-value { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: left !important; padding: 12px 14px 4px !important; }
        .summary-value { padding: 0 14px 12px !important; }
        .item-table { table-layout: fixed !important; }
        .item-cell { padding: 12px 10px !important; font-size: 13px !important; word-break: break-word !important; overflow-wrap: anywhere !important; }
        .qty-cell { width: 44px !important; padding: 12px 6px !important; }
        .subtotal-cell { width: 34% !important; padding: 12px 8px !important; }
        .button-link { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
      }
    </style>
  </head>`;

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
        <td class="item-cell" style="padding:12px;border-bottom:1px solid #ebe4da;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(itemName)}</td>
        <td class="item-cell qty-cell" style="width:52px;padding:12px 8px;border-bottom:1px solid #ebe4da;text-align:center;">${escapeHtml(item.quantity)}</td>
        <td class="item-cell" style="width:30%;padding:12px;border-bottom:1px solid #ebe4da;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(normalizeItemVariant(item))}</td>
      </tr>`;
  }).join('') || `
      <tr>
        <td colspan="3" class="item-cell" style="padding:12px;border-bottom:1px solid #ebe4da;">No item details available.</td>
      </tr>`;

  const htmlContent = `<!doctype html>
<html>${buildEmailHead(`New paid order #${order.id}`)}
  <body style="margin:0;padding:0;background:#FAF8F5;font-family:Arial,Helvetica,sans-serif;color:#3b332c;">
    <div class="email-shell outer-pad" style="width:100%;max-width:600px;margin:0 auto;padding:24px 16px;box-sizing:border-box;">
      <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #ebe4da;">
        <div class="header-pad" style="background:#5D5340;color:#ffffff;padding:24px;">
          <h1 class="email-title" style="margin:0;font-size:24px;line-height:1.3;">New Paid Order</h1>
          <p style="margin:8px 0 0;font-size:14px;opacity:.9;">Order #${escapeHtml(order.id)} is ready for admin review.</p>
        </div>
        <div class="content-pad" style="padding:24px;">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">A customer payment has been successfully confirmed. Please review the order details and prepare fulfillment.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 20px;">
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;width:180px;vertical-align:top;">Order ID</td><td class="summary-value" style="padding:8px 0;font-weight:700;vertical-align:top;">${escapeHtml(order.id)}</td></tr>
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;vertical-align:top;">Customer</td><td class="summary-value" style="padding:8px 0;vertical-align:top;">${escapeHtml(customerName)}</td></tr>
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;vertical-align:top;">Phone</td><td class="summary-value" style="padding:8px 0;vertical-align:top;">${escapeHtml(customerPhone)}</td></tr>
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;vertical-align:top;">Total Payment</td><td class="summary-value" style="padding:8px 0;font-weight:700;vertical-align:top;">${escapeHtml(formatCurrency(order.total_amount))}</td></tr>
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;vertical-align:top;">Payment Method</td><td class="summary-value" style="padding:8px 0;vertical-align:top;">${escapeHtml(paymentMethod)}</td></tr>
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;vertical-align:top;">Shipping Address</td><td class="summary-value" style="padding:8px 0;white-space:pre-line;vertical-align:top;">${escapeHtml(shippingAddress)}</td></tr>
          </table>
          <h2 class="section-title" style="font-size:18px;margin:0 0 12px;">Items</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="item-table" style="border-collapse:collapse;table-layout:fixed;border:1px solid #ebe4da;border-radius:10px;overflow:hidden;margin-bottom:26px;">
            <thead>
              <tr style="background:#ebe4da;">
                <th align="left" style="padding:10px 12px;">Item</th>
                <th align="center" class="qty-cell" style="width:52px;padding:10px 8px;">Qty</th>
                <th align="left" style="padding:10px 12px;">Size / Color</th>
              </tr>
            </thead>
            <tbody>${itemRows}
            </tbody>
          </table>
          <a href="${escapeHtml(adminOrderDetailUrl)}" class="button-link" style="display:inline-block;background:#5D5340;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">Open admin order detail</a>
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


const buildCustomerOrderPaidEmail = ({ order, items = [] }) => {
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
        <td class="item-cell" style="padding:14px 12px;border-bottom:1px solid #ebe4da;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;">
          <div style="font-weight:700;color:#3b332c;">${escapeHtml(itemName)}</div>
          <div style="margin-top:4px;font-size:12px;color:#766d60;">Size: ${escapeHtml(item.size || '-')} &nbsp;|&nbsp; Color: ${escapeHtml(item.color || '-')}</div>
        </td>
        <td class="item-cell qty-cell" style="width:52px;padding:14px 8px;border-bottom:1px solid #ebe4da;text-align:center;vertical-align:top;">${escapeHtml(quantity)}</td>
        <td class="item-cell subtotal-cell" style="width:34%;padding:14px 12px;border-bottom:1px solid #ebe4da;text-align:right;vertical-align:top;font-weight:700;word-break:break-word;">${escapeHtml(formatCurrency(subtotal))}</td>
      </tr>`;
  }).join('') || `
      <tr>
        <td colspan="3" class="item-cell" style="padding:14px 12px;border-bottom:1px solid #ebe4da;">No item details available.</td>
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
<html>${buildEmailHead(`Payment confirmed for order #${order.id}`)}
  <body style="margin:0;padding:0;background:#FAF8F5;font-family:Arial,Helvetica,sans-serif;color:#3b332c;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Thank you for your Nainara Boutique order. Your payment has been confirmed.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FAF8F5;border-collapse:collapse;">
      <tr>
        <td align="center" class="outer-pad" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="email-shell" style="width:100%;max-width:600px;background:#fffdf9;border:1px solid #ebe4da;border-radius:18px;overflow:hidden;border-collapse:separate;">
            <tr>
              <td class="header-pad" style="background:#5D5340;padding:28px 24px;text-align:center;color:#ffffff;">
                <div class="brand-title" style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;letter-spacing:1.6px;font-weight:700;">Nainara Boutique</div>
                <div style="margin-top:8px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#ebe4da;">Payment Confirmed</div>
              </td>
            </tr>
            <tr>
              <td class="content-pad" style="padding:28px 24px;">
                <h1 class="email-title" style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#3b332c;">Thank you, ${escapeHtml(customerName)}.</h1>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#5D5340;">We have received your payment and are preparing your order with care. Below is your confirmation summary.</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ebe4da;border:1px solid #ebe4da;border-radius:14px;margin:0 0 22px;">
                  <tr><td class="summary-label" style="padding:14px 16px;color:#766d60;width:42%;vertical-align:top;">Order ID</td><td class="summary-value" style="padding:14px 16px;font-weight:700;text-align:right;vertical-align:top;">#${escapeHtml(order.id)}</td></tr>
                  <tr><td class="summary-label" style="padding:0 16px 14px;color:#766d60;vertical-align:top;">Payment Status</td><td class="summary-value" style="padding:0 16px 14px;font-weight:700;text-align:right;text-transform:capitalize;color:#5D5340;vertical-align:top;">${escapeHtml(paymentStatus)}</td></tr>
                  <tr><td class="summary-label" style="padding:0 16px 16px;color:#766d60;vertical-align:top;">Payment Amount</td><td class="summary-value" style="padding:0 16px 16px;font-size:18px;font-weight:700;text-align:right;color:#3b332c;vertical-align:top;">${escapeHtml(formatCurrency(order.total_amount))}</td></tr>
                </table>

                <h2 class="section-title" style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#3b332c;">Order items</h2>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="item-table" style="border-collapse:collapse;table-layout:fixed;border:1px solid #ebe4da;border-radius:12px;overflow:hidden;margin:0 0 22px;background:#ffffff;">
                  <thead>
                    <tr style="background:#ebe4da;color:#5D5340;">
                      <th align="left" style="padding:12px;font-size:13px;">Product</th>
                      <th align="center" class="qty-cell" style="width:52px;padding:12px 8px;font-size:13px;">Qty</th>
                      <th align="right" class="subtotal-cell" style="width:34%;padding:12px 8px;font-size:13px;">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>${itemRows}
                  </tbody>
                </table>

                <h2 class="section-title" style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#3b332c;">Shipping address</h2>
                <p style="margin:0;padding:14px 16px;background:#ebe4da;border:1px solid #ebe4da;border-radius:12px;font-size:14px;line-height:1.7;white-space:pre-line;color:#5D5340;">${escapeHtml(shippingAddress)}</p>
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
  ].join('\n');

  return {
    subject: `Payment confirmed for order #${order.id}`,
    htmlContent,
    textContent,
  };
};


const getItemName = (item) => item.product_name || item.name || `Product #${item.product_id || '-'}`;

const buildCompactItemRows = (items = []) => items.map((item) => `
      <tr>
        <td class="item-cell" style="padding:13px 12px;border-bottom:1px solid #ebe4da;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;">
          <div style="font-weight:700;color:#3b332c;">${escapeHtml(getItemName(item))}</div>
          <div style="margin-top:4px;font-size:12px;color:#766d60;">${escapeHtml(normalizeItemVariant(item))}</div>
        </td>
        <td class="item-cell qty-cell" style="width:52px;padding:13px 8px;border-bottom:1px solid #ebe4da;text-align:center;vertical-align:top;">${escapeHtml(item.quantity || '-')}</td>
      </tr>`).join('') || `
      <tr><td colspan="2" class="item-cell" style="padding:13px 12px;border-bottom:1px solid #ebe4da;">No item details available.</td></tr>`;

const buildTextItemLines = (items = []) => (items.length
  ? items.map((item) => `- ${getItemName(item)} | Qty: ${item.quantity || '-'} | Size/Color: ${normalizeItemVariant(item)}`)
  : ['- No item details available.']);

const buildBoutiqueEmail = ({ title, eyebrow, preview, intro, summaryRows = [], items = [] }) => {
  const summaryHtml = summaryRows.filter((row) => row && row.value !== undefined && row.value !== null && row.value !== '').map((row) => `
                  <tr>
                    <td class="summary-label" style="padding:${row.first ? '14px' : '0'} 16px 14px;color:#766d60;width:42%;vertical-align:top;">${escapeHtml(row.label)}</td>
                    <td class="summary-value" style="padding:${row.first ? '14px' : '0'} 16px 14px;font-weight:700;text-align:right;color:#3b332c;vertical-align:top;">${escapeHtml(row.value)}</td>
                  </tr>`).join('');
  const itemRows = buildCompactItemRows(items);

  return `<!doctype html>
<html>${buildEmailHead(title)}
  <body style="margin:0;padding:0;background:#FAF8F5;font-family:Arial,Helvetica,sans-serif;color:#3b332c;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview || title)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FAF8F5;border-collapse:collapse;">
      <tr>
        <td align="center" class="outer-pad" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="email-shell" style="width:100%;max-width:600px;background:#fffdf9;border:1px solid #ebe4da;border-radius:18px;overflow:hidden;border-collapse:separate;">
            <tr>
              <td class="header-pad" style="background:#5D5340;padding:28px 24px;text-align:center;color:#ffffff;">
                <div class="brand-title" style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;letter-spacing:1.6px;font-weight:700;">Nainara Boutique</div>
                <div style="margin-top:8px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#ebe4da;">${escapeHtml(eyebrow)}</div>
              </td>
            </tr>
            <tr>
              <td class="content-pad" style="padding:28px 24px;">
                <h1 class="email-title" style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#3b332c;">${escapeHtml(title)}</h1>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#5D5340;">${escapeHtml(intro)}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ebe4da;border:1px solid #ebe4da;border-radius:14px;margin:0 0 22px;">${summaryHtml}
                </table>
                <h2 class="section-title" style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#3b332c;">Order items</h2>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="item-table" style="border-collapse:collapse;table-layout:fixed;border:1px solid #ebe4da;border-radius:12px;overflow:hidden;margin:0;background:#ffffff;">
                  <thead>
                    <tr style="background:#ebe4da;color:#5D5340;">
                      <th align="left" style="padding:12px;font-size:13px;">Product</th>
                      <th align="center" class="qty-cell" style="width:52px;padding:12px 8px;font-size:13px;">Qty</th>
                    </tr>
                  </thead>
                  <tbody>${itemRows}
                  </tbody>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const buildCustomerRefundStatusEmail = ({ order, items = [], status, reason }) => {
  const normalizedStatus = String(status || order.refund_status || 'requested').toLowerCase();
  const customerName = order.recipient_name || order.user_name || 'Nainara Customer';
  const amount = order.refund_amount ? formatCurrency(order.refund_amount) : null;
  const reasonText = reason || order.refund_reason || (order.refund_midtrans_response && order.refund_midtrans_response.rejection_reason) || null;
  const titleByStatus = {
    requested: `Refund request received for order #${order.id}`,
    refunded: `Refund approved for order #${order.id}`,
    approved: `Refund approved for order #${order.id}`,
    rejected: `Refund request update for order #${order.id}`,
  };
  const introByStatus = {
    requested: `Hi ${customerName}, we have received your refund request and our team will review it shortly.`,
    refunded: `Hi ${customerName}, your refund has been approved and submitted successfully.`,
    approved: `Hi ${customerName}, your refund has been approved and submitted successfully.`,
    rejected: `Hi ${customerName}, we have reviewed your refund request and cannot approve it at this time.`,
  };
  const rows = [
    { label: 'Order ID', value: `#${order.id}`, first: true },
    { label: 'Refund Status', value: normalizedStatus },
    amount && { label: 'Refund Amount', value: amount },
    reasonText && { label: normalizedStatus === 'rejected' ? 'Rejection Reason' : 'Refund Reason', value: reasonText },
  ];
  const htmlContent = buildBoutiqueEmail({
    title: titleByStatus[normalizedStatus] || `Refund update for order #${order.id}`,
    eyebrow: 'Refund Update',
    preview: `Refund status: ${normalizedStatus}`,
    intro: introByStatus[normalizedStatus] || `Hi ${customerName}, there is an update to your refund request.`,
    summaryRows: rows,
    items,
  });
  const textContent = [
    'Nainara Boutique - Refund Update',
    introByStatus[normalizedStatus] || `Hi ${customerName}, there is an update to your refund request.`,
    `Order ID: #${order.id}`,
    `Refund status: ${normalizedStatus}`,
    amount ? `Refund amount: ${amount}` : null,
    reasonText ? `${normalizedStatus === 'rejected' ? 'Rejection' : 'Refund'} reason: ${reasonText}` : null,
    'Items:',
    ...buildTextItemLines(items),
  ].filter(Boolean).join('\n');
  return { subject: titleByStatus[normalizedStatus] || `Refund update for order #${order.id}`, htmlContent, textContent };
};

const buildCustomerOrderCancelledEmail = ({ order, items = [] }) => {
  const customerName = order.recipient_name || order.user_name || 'Nainara Customer';
  const htmlContent = buildBoutiqueEmail({
    title: `Order #${order.id} has been cancelled`,
    eyebrow: 'Order Cancelled',
    preview: `Your Nainara Boutique order #${order.id} has been cancelled.`,
    intro: `Hi ${customerName}, this email confirms that your unpaid/pending order has been cancelled. No further action is required.`,
    summaryRows: [
      { label: 'Order ID', value: `#${order.id}`, first: true },
      { label: 'Order Status', value: 'cancelled' },
      { label: 'Order Total', value: formatCurrency(order.total_amount) },
    ],
    items,
  });
  const textContent = [
    'Nainara Boutique - Order Cancelled',
    `Hi ${customerName}, this confirms that your unpaid/pending order #${order.id} has been cancelled.`,
    `Order total: ${formatCurrency(order.total_amount)}`,
    'Items:',
    ...buildTextItemLines(items),
  ].join('\n');
  return { subject: `Order #${order.id} has been cancelled`, htmlContent, textContent };
};

const buildCustomerOrderShippedEmail = ({ order, items = [] }) => {
  const customerName = order.recipient_name || order.user_name || 'Nainara Customer';
  const htmlContent = buildBoutiqueEmail({
    title: `Order #${order.id} is on the way`,
    eyebrow: 'Order Shipped',
    preview: `Courier: ${order.tracking_courier || '-'}; tracking number: ${order.tracking_number || '-'}`,
    intro: `Hi ${customerName}, your order has been shipped. You can use the courier and tracking number below to follow the delivery.`,
    summaryRows: [
      { label: 'Order ID', value: `#${order.id}`, first: true },
      { label: 'Courier', value: order.tracking_courier || '-' },
      { label: 'Tracking Number', value: order.tracking_number || '-' },
    ],
    items,
  });
  const textContent = [
    'Nainara Boutique - Order Shipped',
    `Hi ${customerName}, your order #${order.id} has been shipped.`,
    `Courier: ${order.tracking_courier || '-'}`,
    `Tracking number: ${order.tracking_number || '-'}`,
    'Items:',
    ...buildTextItemLines(items),
  ].join('\n');
  return { subject: `Order #${order.id} is on the way`, htmlContent, textContent };
};

const buildAdminRefundRequestEmail = ({ order, items = [], adminOrderDetailUrl }) => {
  const customerName = order.recipient_name || order.user_name || 'Customer';
  const customerEmail = order.customer_email || order.user_email || '-';
  const customerPhone = order.phone || '-';
  const itemRows = buildCompactItemRows(items);
  const htmlContent = `<!doctype html>
<html>${buildEmailHead(`Refund request for order #${order.id}`)}
  <body style="margin:0;padding:0;background:#FAF8F5;font-family:Arial,Helvetica,sans-serif;color:#3b332c;">
    <div class="email-shell outer-pad" style="width:100%;max-width:600px;margin:0 auto;padding:24px 16px;box-sizing:border-box;">
      <div style="background:#fffdf9;border-radius:16px;overflow:hidden;border:1px solid #ebe4da;">
        <div class="header-pad" style="background:#5D5340;color:#ffffff;padding:24px;">
          <h1 class="email-title" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;">Refund Request Submitted</h1>
          <p style="margin:8px 0 0;font-size:14px;opacity:.9;">Order #${escapeHtml(order.id)} needs admin review.</p>
        </div>
        <div class="content-pad" style="padding:24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 20px;">
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;width:180px;vertical-align:top;">Order ID</td><td class="summary-value" style="padding:8px 0;font-weight:700;vertical-align:top;">${escapeHtml(order.id)}</td></tr>
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;vertical-align:top;">Customer</td><td class="summary-value" style="padding:8px 0;vertical-align:top;">${escapeHtml(customerName)}</td></tr>
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;vertical-align:top;">Email</td><td class="summary-value" style="padding:8px 0;vertical-align:top;">${escapeHtml(customerEmail)}</td></tr>
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;vertical-align:top;">Phone</td><td class="summary-value" style="padding:8px 0;vertical-align:top;">${escapeHtml(customerPhone)}</td></tr>
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;vertical-align:top;">Refund Reason</td><td class="summary-value" style="padding:8px 0;white-space:pre-line;vertical-align:top;">${escapeHtml(order.refund_reason || '-')}</td></tr>
            <tr><td class="summary-label" style="padding:8px 12px 8px 0;color:#766d60;vertical-align:top;">Total Amount</td><td class="summary-value" style="padding:8px 0;font-weight:700;vertical-align:top;">${escapeHtml(formatCurrency(order.total_amount))}</td></tr>
          </table>
          <h2 class="section-title" style="font-size:18px;margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;">Items</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="item-table" style="border-collapse:collapse;table-layout:fixed;border:1px solid #ebe4da;border-radius:10px;overflow:hidden;margin-bottom:26px;">
            <thead><tr style="background:#ebe4da;"><th align="left" style="padding:10px 12px;">Item</th><th align="center" class="qty-cell" style="width:52px;padding:10px 8px;">Qty</th></tr></thead>
            <tbody>${itemRows}
            </tbody>
          </table>
          <a href="${escapeHtml(adminOrderDetailUrl)}" class="button-link" style="display:inline-block;background:#5D5340;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">Open admin order detail</a>
        </div>
      </div>
    </div>
  </body>
</html>`;
  const textContent = [
    `Refund request submitted for order #${order.id}`,
    `Customer: ${customerName}`,
    `Email: ${customerEmail}`,
    `Phone: ${customerPhone}`,
    `Refund reason: ${order.refund_reason || '-'}`,
    `Total amount: ${formatCurrency(order.total_amount)}`,
    'Items:',
    ...buildTextItemLines(items),
    `Admin order detail: ${adminOrderDetailUrl}`,
  ].join('\n');
  return { subject: `Refund request for order #${order.id}`, htmlContent, textContent };
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


const sendCustomerRefundStatusEmail = async ({ to, order, items, orderDetailUrl, status, reason, env = process.env, fetchImpl }) => {
  const email = buildCustomerRefundStatusEmail({ order, items, orderDetailUrl, status, reason });
  return sendTransactionalEmail({ to, subject: email.subject, htmlContent: email.htmlContent, textContent: email.textContent, env, fetchImpl });
};

const sendCustomerOrderCancelledEmail = async ({ to, order, items, orderDetailUrl, env = process.env, fetchImpl }) => {
  const email = buildCustomerOrderCancelledEmail({ order, items, orderDetailUrl });
  return sendTransactionalEmail({ to, subject: email.subject, htmlContent: email.htmlContent, textContent: email.textContent, env, fetchImpl });
};

const sendCustomerOrderShippedEmail = async ({ to, order, items, orderDetailUrl, env = process.env, fetchImpl }) => {
  const email = buildCustomerOrderShippedEmail({ order, items, orderDetailUrl });
  return sendTransactionalEmail({ to, subject: email.subject, htmlContent: email.htmlContent, textContent: email.textContent, env, fetchImpl });
};

const sendAdminRefundRequestNotification = async ({ order, items, adminOrderDetailUrl, env = process.env, fetchImpl }) => {
  const email = buildAdminRefundRequestEmail({ order, items, adminOrderDetailUrl });
  return sendTransactionalEmail({ to: env.ADMIN_NOTIFICATION_EMAIL, subject: email.subject, htmlContent: email.htmlContent, textContent: email.textContent, env, fetchImpl });
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
  buildAdminRefundRequestEmail,
  buildCustomerOrderCancelledEmail,
  buildCustomerOrderDetailUrl,
  buildCustomerOrderPaidEmail,
  buildCustomerOrderShippedEmail,
  buildCustomerRefundStatusEmail,
  escapeHtml,
  formatCurrency,
  getMissingEmailEnv,
  sendAdminOrderPaidNotification,
  sendAdminRefundRequestNotification,
  sendCustomerOrderCancelledEmail,
  sendCustomerOrderPaidConfirmation,
  sendCustomerOrderShippedEmail,
  sendCustomerRefundStatusEmail,
  sendTransactionalEmail,
};
