-- Stock quantity protection support for variant-aware orders.
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
