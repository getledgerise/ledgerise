-- Ledgerise core ingestion tables.
-- PostgreSQL reference migration for the MVP data model.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id),
  email text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, email)
);

CREATE TABLE adapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id),
  name text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  runtime text NOT NULL CHECK (runtime IN ('internal', 'http')),
  version text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, name)
);

CREATE TABLE canonical_transactions (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators(id),
  source_system text NOT NULL,
  source_adapter text NOT NULL,
  source_id text,
  source_environment text NOT NULL DEFAULT 'live' CHECK (source_environment IN ('live', 'test')),
  status text NOT NULL CHECK (status IN ('pending', 'settled', 'failed', 'reversed', 'disputed')),
  type text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount numeric(20, 0) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL,
  product_line text NOT NULL,
  product_biller text,
  product_biller_category text,
  occurred_at timestamptz NOT NULL,
  settled_at timestamptz,
  posting_status text NOT NULL DEFAULT 'unposted',
  dedupe_confidence text NOT NULL CHECK (dedupe_confidence IN ('high', 'low')),
  canonical_record jsonb NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX canonical_transactions_source_identity_idx
  ON canonical_transactions (operator_id, source_system, source_adapter, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX canonical_transactions_operator_status_idx
  ON canonical_transactions (operator_id, status, posting_status);

CREATE INDEX canonical_transactions_operator_product_idx
  ON canonical_transactions (operator_id, product_line, product_biller, product_biller_category);

CREATE INDEX canonical_transactions_operator_occurred_at_idx
  ON canonical_transactions (operator_id, occurred_at DESC);

CREATE TABLE transaction_ingestion_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id),
  adapter_name text NOT NULL,
  error_type text NOT NULL CHECK (
    error_type IN ('schema_validation', 'adapter_mismatch', 'duplicate_source')
  ),
  source_system text,
  source_id text,
  existing_transaction_id uuid REFERENCES canonical_transactions(id),
  raw_record jsonb NOT NULL,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transaction_ingestion_errors_operator_created_at_idx
  ON transaction_ingestion_errors (operator_id, created_at DESC);

CREATE INDEX transaction_ingestion_errors_source_idx
  ON transaction_ingestion_errors (operator_id, adapter_name, source_system, source_id);
