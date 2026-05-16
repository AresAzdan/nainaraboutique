-- Reusable product size guides and product-specific size guide assignments.
CREATE TABLE IF NOT EXISTS size_guides (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  columns    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  rows       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS size_guide_id INTEGER,
  ADD COLUMN IF NOT EXISTS size_guide_data JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_size_guide_id_fkey'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_size_guide_id_fkey
      FOREIGN KEY (size_guide_id) REFERENCES size_guides(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_size_guide_id ON products(size_guide_id);
