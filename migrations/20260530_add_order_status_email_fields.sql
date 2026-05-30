-- Persist order status email claims so endpoint/webhook retries and repeated
-- actions do not send duplicate transactional emails.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_refund_requested_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_refund_result_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_cancelled_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_shipped_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_refund_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_customer_refund_requested_email_sent_at
  ON orders(customer_refund_requested_email_sent_at)
  WHERE customer_refund_requested_email_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_refund_result_email_sent_at
  ON orders(customer_refund_result_email_sent_at)
  WHERE customer_refund_result_email_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_cancelled_email_sent_at
  ON orders(customer_cancelled_email_sent_at)
  WHERE customer_cancelled_email_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_shipped_email_sent_at
  ON orders(customer_shipped_email_sent_at)
  WHERE customer_shipped_email_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_admin_refund_notified_at
  ON orders(admin_refund_notified_at)
  WHERE admin_refund_notified_at IS NOT NULL;

