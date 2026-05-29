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
    };
  });
}

function calculateOrderTotal({ items, shippingCost = 0, discountAmount = 0 }) {
  return (items || []).reduce((sum, i) => sum + Number(i.price) * Number(i.quantity), 0) +
    Number(shippingCost) -
    Number(discountAmount);
}

module.exports = {
  buildPricedOrderItems,
  calculateOrderTotal,
};
