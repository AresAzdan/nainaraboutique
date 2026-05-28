-- Persist admin activity for the Activity Log screen.
-- Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS activity_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(100) NOT NULL,
  description TEXT         NOT NULL,
  type        VARCHAR(50)  NOT NULL,
  entity_type VARCHAR(50),
  entity_id   VARCHAR(100),
  metadata    JSONB        NOT NULL DEFAULT '{}'::JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type_created_at ON activity_logs(type, created_at DESC);
