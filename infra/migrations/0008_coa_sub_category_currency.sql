-- Add sub_category and currency to chart_of_accounts.
-- sub_category: optional free-text grouping within a type class (e.g. 'Cash & Bank', 'Trade Payables').
-- currency: ISO 4217 code for the account's functional currency. Defaults to NGN.

ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS sub_category text,
  ADD COLUMN IF NOT EXISTS currency char(3) NOT NULL DEFAULT 'NGN';

CREATE INDEX IF NOT EXISTS chart_of_accounts_currency_idx
  ON chart_of_accounts (operator_id, currency);
