-- Stock quantity protection support for variant-aware orders.
-- Minimal color + size stock schema: products.variant_stocks JSONB.
-- Supported shapes: {"Color A": {"XL": 4}, "Color B": {"XL": 0}}
-- or flat keys: {"Color A::XL": 4, "Color B::XL": 0}.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS size VARCHAR(50),
  ADD COLUMN IF NOT EXISTS color TEXT;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS size_stocks JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS variant_stocks JSONB NOT NULL DEFAULT '{}'::jsonb;


ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS size VARCHAR(50),
  ADD COLUMN IF NOT EXISTS color TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_cart_id_product_id_key'
  ) THEN
    ALTER TABLE cart_items DROP CONSTRAINT cart_items_cart_id_product_id_key;
  END IF;

END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cart_items_cart_product_size_color_idx
  ON cart_items (cart_id, product_id, COALESCE(size, ''), COALESCE(color, ''));
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS size VARCHAR(50);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS size_stocks JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_nonnegative'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_stock_nonnegative CHECK (stock >= 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE products
  VALIDATE CONSTRAINT products_stock_nonnegative;
