-- Add restock timestamp so products can be promoted when returning in stock.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS last_restocked_at TIMESTAMPTZ;

