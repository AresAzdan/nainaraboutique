-- Persist customer email recipients and paid-confirmation email claims so
-- retried Midtrans webhooks do not send duplicate customer confirmations.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_email VARCHAR(150),
  ADD COLUMN IF NOT EXISTS customer_paid_email_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_customer_paid_email_sent_at
  ON orders(customer_paid_email_sent_at)
  WHERE customer_paid_email_sent_at IS NOT NULL;
