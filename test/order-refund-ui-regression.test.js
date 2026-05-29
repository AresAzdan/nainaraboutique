const assert = require('assert');
const fs = require('fs');
const path = require('path');

const customerHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'nainara_admin.html'), 'utf8');

assert(
  customerHtml.includes("${order.status === 'pending' ? `") &&
    customerHtml.includes('Cancel Order</button>') &&
    customerHtml.includes('Request Refund</button>'),
  'customer order detail must render Cancel Order for pending orders and Request Refund for paid/settled orders'
);

assert(
  customerHtml.includes("['paid', 'settlement'].includes(String(status).toLowerCase())") &&
    customerHtml.includes('this.requestRefund(id);'),
  'paid/settled customer actions must be routed to requestRefund instead of the cancel endpoint'
);

assert(
  customerHtml.includes('/refund-request') &&
    customerHtml.includes('method: "POST"') &&
    customerHtml.includes('body: JSON.stringify({ reason })'),
  'customer refund requests must call the refund request endpoint with a reason payload'
);

assert(
  customerHtml.includes("if (!reason)") &&
    customerHtml.includes('Refund reason is required.'),
  'customer refund request UI must require a reason before submitting'
);

assert(
  adminHtml.includes("/api/admin/orders/' + id + '/refund") &&
    adminHtml.includes("JSON.stringify({ action, reason })") &&
    adminHtml.includes('Approve Refund'),
  'admin refund approval UI must call the refund review endpoint, which invokes Midtrans from the backend service'
);

console.log('order refund UI regression checks passed');
