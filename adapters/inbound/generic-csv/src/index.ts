import { randomUUID } from 'node:crypto';

import {
  adapterError,
  ok,
  validationFailed,
  type AdapterHealthcheckResult,
  type AdapterMeta,
  type AdapterResult,
  type AdapterRowError,
  type AdapterValidationError,
  type AdapterValidationResult
} from '@ledgerise/adapter-sdk';
import type { CanonicalTransaction } from '@ledgerise/canonical-types';
import { validateCanonicalTransaction } from '@ledgerise/core-schema';

import adapter from '../adapter.json' with { type: 'json' };

export interface GenericCsvInput {
  content: string;
  filename?: string;
  config: GenericCsvConfig;
}

export interface GenericCsvConfig {
  source_system: string;
  environment?: 'live' | 'test';
  column_mappings: Record<string, string>;
  defaults?: Record<string, unknown>;
  metadata_columns?: Record<string, string>;
  delimiter?: string;
  amount_multiplier?: number;
}

export function meta(): AdapterMeta {
  return adapter as AdapterMeta;
}

export function validate(input: GenericCsvInput): AdapterValidationResult {
  const errors: AdapterValidationError[] = [];

  if (!isRecord(input)) {
    return {
      valid: false,
      errors: [
        {
          field: '$',
          message: 'Input must be an object',
          raw_value: input
        }
      ]
    };
  }

  if (typeof input.content !== 'string' || !input.content.trim()) {
    errors.push({
      field: 'content',
      message: 'CSV content is required',
      raw_value: input.content
    });
  }

  if (!isRecord(input.config)) {
    errors.push({
      field: 'config',
      message: 'Config must be an object',
      raw_value: input.config
    });
  }

  if (isRecord(input.config)) {
    if (typeof input.config.source_system !== 'string' || !input.config.source_system) {
      errors.push({
        field: 'config.source_system',
        message: 'source_system is required',
        raw_value: input.config.source_system
      });
    }

    if (!isRecord(input.config.column_mappings)) {
      errors.push({
        field: 'config.column_mappings',
        message: 'column_mappings is required',
        raw_value: input.config.column_mappings
      });
    }

    if (input.config.delimiter !== undefined && input.config.delimiter.length !== 1) {
      errors.push({
        field: 'config.delimiter',
        message: 'delimiter must be a single character',
        raw_value: input.config.delimiter
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export async function normalize(input: GenericCsvInput): Promise<AdapterResult<CanonicalTransaction>> {
  const inputValidation = validate(input);

  if (!inputValidation.valid) {
    return validationFailed('Generic CSV input failed validation', inputValidation.errors, input);
  }

  try {
    const rows = parseCsv(input.content, input.config.delimiter ?? ',');

    if (rows.length < 2) {
      return validationFailed(
        'CSV content must include a header row and at least one data row',
        [
          {
            field: 'content',
            message: 'Missing data rows',
            raw_value: input.content
          }
        ],
        input.content
      );
    }

    const [headers, ...dataRows] = rows;
    const records: CanonicalTransaction[] = [];
    const rowErrors: AdapterRowError[] = [];

    for (const [index, row] of dataRows.entries()) {
      const rowNumber = index + 2;
      const rowObject = rowToObject(headers ?? [], row);
      const record = buildCanonicalRecord(rowObject, input.config);
      const outputValidation = validateCanonicalTransaction(record);

      if (!outputValidation.valid) {
        rowErrors.push({
          row: rowNumber,
          raw: rowObject,
          errors: outputValidation.errors.map((error) => ({
            field: error.fieldPath,
            message: error.message,
            raw_value: error.rawValue
          }))
        });
        continue;
      }

      records.push(record);
    }

    if (records.length === 0) {
      return validationFailed(
        'No CSV rows produced valid canonical transactions',
        rowErrors.flatMap((rowError) =>
          rowError.errors.map((error) => ({
            ...error,
            field: `row.${rowError.row}.${error.field}`
          }))
        ),
        input.content
      );
    }

    return ok(records, undefined, rowErrors);
  } catch (error) {
    return adapterError(
      'ADAPTER_NORMALIZATION_FAILED',
      error instanceof Error ? error.message : 'Generic CSV normalization failed',
      input.filename ?? input.content
    );
  }
}

export async function healthcheck(): Promise<AdapterHealthcheckResult> {
  return {
    status: 'ok',
    latency_ms: 0,
    checked_at: new Date().toISOString()
  };
}

function buildCanonicalRecord(
  row: Record<string, string>,
  config: GenericCsvConfig
): CanonicalTransaction {
  const record: Record<string, unknown> = {};

  for (const [canonicalPath, columnName] of Object.entries(config.column_mappings)) {
    const value = row[columnName];

    if (value !== undefined && value !== '') {
      setPath(record, canonicalPath, coerceCsvValue(value));
    }
  }

  for (const [canonicalPath, value] of Object.entries(config.defaults ?? {})) {
    if (getPath(record, canonicalPath) === undefined) {
      setPath(record, canonicalPath, value);
    }
  }

  const metadata: Record<string, unknown> = isRecord(record.metadata)
    ? { ...record.metadata }
    : {};

  for (const [metadataKey, columnName] of Object.entries(config.metadata_columns ?? {})) {
    const value = row[columnName];

    if (value !== undefined && value !== '') {
      metadata[metadataKey] = coerceCsvValue(value);
    }
  }

  record.id = randomUUID();
  record.processed_at = new Date().toISOString();
  record.source = {
    ...(isRecord(record.source) ? record.source : {}),
    adapter: meta().name,
    system: config.source_system,
    environment: config.environment ?? getPath(record, 'source.environment') ?? 'live'
  };
  record.metadata = metadata;

  if (typeof record.amount === 'number' && config.amount_multiplier) {
    record.amount = Math.round(record.amount * config.amount_multiplier);
  }

  return record as unknown as CanonicalTransaction;
}

function parseCsv(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  return rows.filter((parsedRow) => parsedRow.some((cell) => cell.trim() !== ''));
}

function rowToObject(headers: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header.trim(), row[index]?.trim() ?? '']));
}

function coerceCsvValue(value: string): unknown {
  if (value === 'null') {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function getPath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, input);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = target;

  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }

    const next = current[segment];

    if (!isRecord(next)) {
      current[segment] = {};
    }

    current = current[segment] as Record<string, unknown>;
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}
