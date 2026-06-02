-- Posting queue state and posting attempts for generated journal entries.

ALTER TABLE journal_entries
  ADD COLUMN posting_status text NOT NULL DEFAULT 'generated'
    CHECK (posting_status IN ('generated', 'posting', 'posted', 'failed', 'unmapped', 'retry_exhausted')),
  ADD COLUMN posted_at timestamptz,
  ADD COLUMN last_posting_attempt_at timestamptz,
  ADD COLUMN last_posting_error text;

UPDATE journal_entries
SET posting_status = 'unmapped'
WHERE status = 'unmapped';

CREATE INDEX journal_entries_operator_posting_status_idx
  ON journal_entries (operator_id, posting_status, generated_at DESC);

CREATE TABLE posting_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id),
  adapter_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'posting', 'posted', 'failed', 'retry_exhausted')),
  journal_entry_count integer NOT NULL CHECK (journal_entry_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX posting_batches_operator_status_idx
  ON posting_batches (operator_id, status, created_at DESC);

CREATE TABLE posting_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  posting_batch_id uuid REFERENCES posting_batches(id) ON DELETE SET NULL,
  adapter_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'posting', 'posted', 'failed', 'retry_requested')),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  external_reference text,
  error_code text,
  error_message text,
  requested_by_user_id uuid REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journal_entry_id, attempt_number)
);

CREATE INDEX posting_attempts_entry_idx
  ON posting_attempts (journal_entry_id, attempt_number DESC);

CREATE INDEX posting_attempts_operator_status_idx
  ON posting_attempts (operator_id, status, occurred_at DESC);
