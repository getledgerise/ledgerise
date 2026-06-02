import type { CanonicalTransaction } from '@ledgerise/canonical-types';

export type AdapterDirection = 'inbound' | 'outbound';
export type AdapterRuntime = 'internal' | 'http';
export type AdapterStatus = 'ok' | 'error';
export type AdapterErrorCode =
  | 'VALIDATION_FAILED'
  | 'SOURCE_UNREACHABLE'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'MALFORMED_PAYLOAD'
  | 'UNSUPPORTED_EVENT'
  | 'METHOD_NOT_SUPPORTED'
  | `ADAPTER_${string}`;

export interface AdapterMeta {
  name: string;
  version: string;
  direction: AdapterDirection;
  source_system?: string;
  target_system?: string;
  modes: string[];
  currency_codes: string[];
  runtime: {
    type: AdapterRuntime;
  };
}

export interface AdapterValidationError {
  field: string;
  message: string;
  raw_value?: unknown;
}

export interface AdapterValidationResult {
  valid: boolean;
  errors: AdapterValidationError[];
}

export interface AdapterRowError {
  row: number;
  errors: AdapterValidationError[];
  raw?: unknown;
}

export interface AdapterError {
  status: 'error';
  code: AdapterErrorCode;
  message: string;
  raw?: unknown;
  errors?: AdapterValidationError[];
}

export interface AdapterSuccess<TRecord = CanonicalTransaction, TCursor = unknown> {
  status: 'ok';
  records: TRecord[];
  cursor?: TCursor;
  row_errors?: AdapterRowError[];
}

export type AdapterResult<TRecord = CanonicalTransaction, TCursor = unknown> =
  | AdapterSuccess<TRecord, TCursor>
  | AdapterError;

export interface AdapterHealthcheckOk {
  status: 'ok';
  latency_ms: number;
  checked_at: string;
}

export interface AdapterHealthcheckError {
  status: 'error';
  code: AdapterErrorCode;
  message: string;
  checked_at: string;
}

export type AdapterHealthcheckResult = AdapterHealthcheckOk | AdapterHealthcheckError;

export interface AdapterModule<TInput = unknown, TCursor = unknown> {
  meta(): AdapterMeta;
  validate(input: TInput): AdapterValidationResult;
  normalize(input: TInput): Promise<AdapterResult<CanonicalTransaction, TCursor>>;
  healthcheck(): Promise<AdapterHealthcheckResult>;
}

export interface OutboundJournalLine {
  account_code: string;
  side: 'debit' | 'credit';
  amount: number;
  currency: string;
  line_order: number;
}

export interface OutboundJournalEntry {
  id: string;
  transaction_id: string;
  source_id?: string;
  transaction_type?: string;
  product_line?: string;
  product_biller?: string;
  entry_type: string;
  currency: string;
  amount: number;
  generated_at: string;
  mapping_rule_id?: string;
  mapping_rule_version?: number;
  lines: OutboundJournalLine[];
}

export interface OutboundJournalBatch {
  id: string;
  operator_id: string;
  adapter_name: string;
  created_at: string;
  entries: OutboundJournalEntry[];
}

export interface OutboundJournalPostSuccess {
  journal_entry_id: string;
  external_reference: string;
}

export interface OutboundJournalPostFailure {
  journal_entry_id: string;
  code: AdapterErrorCode;
  message: string;
}

export interface OutboundJournalPostResult {
  status: 'ok' | 'partial' | 'error';
  batch_id: string;
  posted: OutboundJournalPostSuccess[];
  failed: OutboundJournalPostFailure[];
  artifact?: {
    content_type: string;
    filename: string;
    content: string;
  };
}

export interface OutboundJournalAdapterModule {
  meta(): AdapterMeta;
  validate(input: OutboundJournalBatch): AdapterValidationResult;
  postJournals(input: OutboundJournalBatch): Promise<OutboundJournalPostResult>;
  healthcheck(): Promise<AdapterHealthcheckResult>;
}

export function ok<TRecord = CanonicalTransaction, TCursor = unknown>(
  records: TRecord[],
  cursor?: TCursor,
  rowErrors?: AdapterRowError[]
): AdapterSuccess<TRecord, TCursor> {
  return {
    status: 'ok',
    records,
    ...(cursor === undefined ? {} : { cursor }),
    ...(rowErrors && rowErrors.length > 0 ? { row_errors: rowErrors } : {})
  };
}

export function validationFailed(
  message: string,
  errors: AdapterValidationError[],
  raw?: unknown
): AdapterError {
  return {
    status: 'error',
    code: 'VALIDATION_FAILED',
    message,
    errors,
    raw
  };
}

export function adapterError(code: AdapterErrorCode, message: string, raw?: unknown): AdapterError {
  return {
    status: 'error',
    code,
    message,
    raw
  };
}
