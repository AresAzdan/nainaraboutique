BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_midtrans_response JSONB,
  ADD COLUMN IF NOT EXISTS refund_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_refund_status_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_refund_status_check
      CHECK (refund_status IN ('none', 'requested', 'approved', 'rejected', 'processing', 'refunded', 'failed'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_refund_amount_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_refund_amount_check
      CHECK (refund_amount IS NULL OR refund_amount >= 0)
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_refund_status_created_at
  ON orders(refund_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_refund_requested_at
  ON orders(refund_requested_at DESC)
  WHERE refund_status IN ('requested', 'processing', 'failed');

COMMIT;
