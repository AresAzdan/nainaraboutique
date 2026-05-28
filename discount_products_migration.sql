-- Ensure event-based promo/discount product targeting exists.
-- Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS discount_products (
  discount_id INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (discount_id, product_id)
);
