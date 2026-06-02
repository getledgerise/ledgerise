-- Journal entries and lines generated from canonical transactions.

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id),
  transaction_id uuid NOT NULL REFERENCES canonical_transactions(id),
  entry_type text NOT NULL CHECK (entry_type IN ('standard', 'reversal', 'unmapped')),
  status text NOT NULL CHECK (status IN ('generated', 'unmapped')),
  currency char(3) NOT NULL,
  amount numeric(20, 0) NOT NULL CHECK (amount >= 0),
  mapping_rule_id uuid REFERENCES mapping_rules(id),
  mapping_rule_version integer,
  reversal_of_journal_entry_id uuid REFERENCES journal_entries(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, transaction_id)
);

CREATE INDEX journal_entries_operator_status_idx
  ON journal_entries (operator_id, status, generated_at DESC);

CREATE INDEX journal_entries_mapping_rule_idx
  ON journal_entries (operator_id, mapping_rule_id);

CREATE TABLE journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES operators(id),
  account_code text NOT NULL,
  side text NOT NULL CHECK (side IN ('debit', 'credit')),
  amount numeric(20, 0) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL,
  line_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operator_id, account_code)
    REFERENCES chart_of_accounts(operator_id, code),
  UNIQUE (journal_entry_id, line_order)
);

CREATE INDEX journal_entry_lines_entry_idx
  ON journal_entry_lines (journal_entry_id, line_order);

CREATE INDEX journal_entry_lines_account_idx
  ON journal_entry_lines (operator_id, account_code);
