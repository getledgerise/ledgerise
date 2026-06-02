-- User roles/status and API key management metadata.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'finance' CHECK (role IN ('admin', 'finance', 'auditor')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_hash text;

CREATE INDEX IF NOT EXISTS users_operator_status_idx
  ON users (operator_id, status, created_at DESC);

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS api_keys_operator_created_idx
  ON api_keys (operator_id, created_at DESC);
