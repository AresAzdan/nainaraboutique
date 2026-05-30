function normalizeQuantity(value) {
  const qty = Number(value);
  return Number.isInteger(qty) && qty > 0 ? qty : 0;
}

function getSnapshot(snapshots, productId) {
  if (!snapshots) return null;
  if (typeof snapshots.get === 'function') return snapshots.get(Number(productId)) || snapshots.get(String(productId)) || null;
  return snapshots[productId] || snapshots[Number(productId)] || null;
}

function buildPricedOrderItems(items, pricingSnapshots) {
  return (items || []).map((item) => {
    const productId = Number(item.product_id);
    const quantity = normalizeQuantity(item.quantity);
    const snapshot = getSnapshot(pricingSnapshots, productId);

    if (!Number.isInteger(productId) || !snapshot) {
      const err = new Error(`Product ${item.product_id} was not found.`);
      err.status = 400;
      throw err;
    }

    if (!quantity) {
      const err = new Error(`Invalid quantity for product ${productId}.`);
      err.status = 400;
      throw err;
    }

    return {
      product_id: productId,
      quantity,
      price: Number(snapshot.final_price),
      product_name: snapshot.name || item.product_name || null,
      size: item.size || null,
      color: item.color || null,
    };
  });
}

function calculateOrderTotal({ items, shippingCost = 0, discountAmount = 0 }) {
  return (items || []).reduce((sum, i) => sum + Number(i.price) * Number(i.quantity), 0) +
    Number(shippingCost) -
    Number(discountAmount);
}

function buildMidtransItemName(item) {
  const baseName = item.product_name || `Product ${item.product_id}`;
  const variants = [item.size, item.color]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean);

  return variants.length > 0 ? `${baseName} - ${variants.join(' / ')}` : baseName;
}

function toMidtransIntegerAmount(value, fieldName) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) {
    const err = new Error(`${fieldName} must be a finite number.`);
    err.status = 400;
    throw err;
  }

  const rounded = Math.round(amount);
  if (rounded !== amount) {
    const err = new Error(`${fieldName} must be an integer amount for Midtrans item_details.`);
    err.status = 400;
    throw err;
  }

  return rounded;
}

function buildMidtransItemDetails({ items, shippingCost = 0, discountAmount = 0 }) {
  const itemDetails = (items || []).map((item) => ({
    id: String(item.product_id),
    name: buildMidtransItemName(item),
    quantity: normalizeQuantity(item.quantity),
    price: toMidtransIntegerAmount(item.price, `Price for product ${item.product_id}`),
  }));

  const normalizedShippingCost = toMidtransIntegerAmount(shippingCost, 'Shipping cost');
  if (normalizedShippingCost > 0) {
    itemDetails.push({
      id: 'SHIPPING',
      name: 'Shipping Fee',
      quantity: 1,
      price: normalizedShippingCost,
    });
  }

  const normalizedDiscountAmount = toMidtransIntegerAmount(discountAmount, 'Discount amount');
  if (normalizedDiscountAmount > 0) {
    itemDetails.push({
      id: 'DISCOUNT',
      name: 'Discount',
      quantity: 1,
      price: -normalizedDiscountAmount,
    });
  }

  return itemDetails;
}

function sumMidtransItemDetails(itemDetails) {
  return (itemDetails || []).reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity),
    0
  );
}

function buildCustomerDetails({ firstName, email, phone, shippingAddress }) {
  const normalizedFirstName = firstName || 'Customer';
  const normalizedPhone = phone || '';

  return {
    first_name: normalizedFirstName,
    email: email || '',
    phone: normalizedPhone,
    shipping_address: {
      first_name: normalizedFirstName,
      phone: normalizedPhone,
      address: shippingAddress || '',
    },
  };
}

function buildMidtransSnapPayload({
  orderId,
  grossAmount,
  items,
  shippingCost = 0,
  discountAmount = 0,
  customer,
}) {
  const grossAmountInteger = toMidtransIntegerAmount(grossAmount, 'Gross amount');
  const itemDetails = buildMidtransItemDetails({ items, shippingCost, discountAmount });
  const itemDetailsTotal = sumMidtransItemDetails(itemDetails);

  if (itemDetailsTotal !== grossAmountInteger) {
    const err = new Error(
      `Midtrans item_details total (${itemDetailsTotal}) must equal gross_amount (${grossAmountInteger}).`
    );
    err.status = 400;
    throw err;
  }

  return {
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmountInteger,
    },
    item_details: itemDetails,
    customer_details: buildCustomerDetails(customer || {}),
  };
}

module.exports = {
  buildPricedOrderItems,
  calculateOrderTotal,
  buildMidtransSnapPayload,
};
