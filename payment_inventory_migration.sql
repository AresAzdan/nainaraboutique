-- Track whether order inventory has already been moved for a paid Midtrans transaction.
-- This makes settlement/capture webhook handling idempotent and allows stock to be
-- restored if Midtrans later reports cancel/expire/failure for the same order.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stock_deducted BOOLEAN NOT NULL DEFAULT false;

-- Keep order status constraints aligned with the statuses emitted by the Midtrans
-- webhook handler. Drop unknown prior constraint name defensively, then recreate.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'pending', 'paid', 'processing', 'shipped', 'completed',
    'cancelled', 'expired', 'failed', 'refunded', 'chargeback',
    'return_requested', 'returned'
  ));
