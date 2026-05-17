-- ------------------------------------------------------------
-- Return Request Migration
-- Run after schema.sql:
--   psql -U postgres -d ecommerce_db -f return_migration.sql
-- ------------------------------------------------------------

-- 1. Update orders status to include 'return_requested' and 'returned'
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'paid', 'shipped', 'completed', 'cancelled', 'return_requested', 'returned'));

-- 2. Add delivered_at column to orders (set by admin when marking as completed)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- 3. Create return_requests table
CREATE TABLE IF NOT EXISTS return_requests (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id         INTEGER        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_item_id   INTEGER        NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  reason          TEXT           NOT NULL,
  new_size        VARCHAR(50)    NOT NULL,       -- the replacement size they want
  video_url       TEXT           NOT NULL,        -- unboxing video proof
  status          VARCHAR(20)    NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes     TEXT,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE(order_item_id)  -- one return per item
);
