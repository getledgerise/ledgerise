-- Durable poll runner cursor and run history for inbound polling adapters.

CREATE TABLE adapter_poll_cursors (
  operator_id uuid NOT NULL,
  adapter_name text NOT NULL,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  advanced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, adapter_name),
  FOREIGN KEY (operator_id, adapter_name)
    REFERENCES adapters(operator_id, name)
    ON DELETE CASCADE
);

CREATE TABLE adapter_poll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL,
  adapter_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  previous_cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_cursor jsonb,
  records_fetched integer NOT NULL DEFAULT 0 CHECK (records_fetched >= 0),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (operator_id, adapter_name)
    REFERENCES adapters(operator_id, name)
    ON DELETE CASCADE
);

CREATE INDEX adapter_poll_runs_operator_adapter_started_idx
  ON adapter_poll_runs (operator_id, adapter_name, started_at DESC);

CREATE INDEX adapter_poll_runs_operator_status_idx
  ON adapter_poll_runs (operator_id, status, started_at DESC);
