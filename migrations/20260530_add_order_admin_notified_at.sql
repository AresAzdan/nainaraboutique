-- Persist when the admin paid-order notification has been claimed/sent so
-- retried payment webhooks do not send duplicate emails.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS admin_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_admin_notified_at
  ON orders(admin_notified_at)
  WHERE admin_notified_at IS NOT NULL;
