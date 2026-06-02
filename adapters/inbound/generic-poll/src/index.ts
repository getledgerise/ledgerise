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

export interface GenericPollCursor {
  last_fetched_at?: string;
  last_source_id?: string;
  [key: string]: unknown;
}

export interface GenericPollInput {
  cursor?: GenericPollCursor;
  config: GenericPollConfig;
  fetcher?: GenericPollFetcher;
}

export interface GenericPollConfig {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  records_path: string;
  source_system: string;
  environment?: 'live' | 'test';
  field_mappings: Record<string, string>;
  defaults?: Record<string, unknown>;
  metadata_paths?: Record<string, string>;
  cursor_query_param?: string;
  cursor_response_path?: string;
  next_cursor_record_path?: string;
  page_query_param?: string;
  next_page_response_path?: string;
  max_pages?: number;
  amount_multiplier?: number;
}

export type GenericPollFetcher = (
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
  }
) => Promise<GenericPollResponse>;

export interface GenericPollResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export function meta(): AdapterMeta {
  return adapter as AdapterMeta;
}

export function validate(input: GenericPollInput): AdapterValidationResult {
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

  if (!isRecord(input.config)) {
    errors.push({
      field: 'config',
      message: 'Config must be an object',
      raw_value: input.config
    });
  }

  if (isRecord(input.config)) {
    if (typeof input.config.url !== 'string' || !input.config.url) {
      errors.push({
        field: 'config.url',
        message: 'url is required',
        raw_value: input.config.url
      });
    }

    if (typeof input.config.records_path !== 'string' || !input.config.records_path) {
      errors.push({
        field: 'config.records_path',
        message: 'records_path is required',
        raw_value: input.config.records_path
      });
    }

    if (typeof input.config.source_system !== 'string' || !input.config.source_system) {
      errors.push({
        field: 'config.source_system',
        message: 'source_system is required',
        raw_value: input.config.source_system
      });
    }

    if (!isRecord(input.config.field_mappings)) {
      errors.push({
        field: 'config.field_mappings',
        message: 'field_mappings is required',
        raw_value: input.config.field_mappings
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export async function normalize(
  input: GenericPollInput
): Promise<AdapterResult<CanonicalTransaction, GenericPollCursor>> {
  const inputValidation = validate(input);

  if (!inputValidation.valid) {
    return validationFailed('Generic poll input failed validation', inputValidation.errors, input);
  }

  try {
    const fetcher = getFetcher(input);
    const rawRecords: unknown[] = [];
    let latestBody: unknown;
    let nextPageToken: string | undefined;
    let pageCount = 0;

    do {
      const response = await fetcher(buildUrl(input, nextPageToken), {
        method: input.config.method ?? 'GET',
        headers: input.config.headers ?? {}
      });

      if (!response.ok) {
        return adapterError(
          'SOURCE_UNREACHABLE',
          `Generic poll source returned HTTP ${response.status}`,
          { url: input.config.url, status: response.status }
        );
      }

      latestBody = await response.json();
      const pageRecords = getPath(latestBody, input.config.records_path);

      if (!Array.isArray(pageRecords)) {
        return validationFailed(
          'Generic poll records_path did not resolve to an array',
          [
            {
              field: 'config.records_path',
              message: 'records_path must point to an array in the response body',
              raw_value: pageRecords
            }
          ],
          latestBody
        );
      }

      rawRecords.push(...pageRecords);
      pageCount += 1;
      nextPageToken = readNextPageToken(latestBody, input.config);
    } while (nextPageToken && pageCount < (input.config.max_pages ?? 10));

    const records: CanonicalTransaction[] = [];
    const rowErrors: AdapterRowError[] = [];

    for (const [index, rawRecord] of rawRecords.entries()) {
      const record = buildCanonicalRecord(rawRecord, input.config);
      const validationResult = validateCanonicalTransaction(record);

      if (!validationResult.valid) {
        rowErrors.push({
          row: index,
          raw: rawRecord,
          errors: validationResult.errors.map((error) => ({
            field: error.fieldPath,
            message: error.message,
            raw_value: error.rawValue
          }))
        });
        continue;
      }

      records.push(record);
    }

    if (records.length === 0 && rawRecords.length > 0) {
      return validationFailed(
        'No poll records produced valid canonical transactions',
        rowErrors.flatMap((rowError) =>
          rowError.errors.map((error) => ({
            ...error,
            field: `record.${rowError.row}.${error.field}`
          }))
        ),
        latestBody
      );
    }

    return ok(records, buildCursor(latestBody, rawRecords, input), rowErrors);
  } catch (error) {
    return adapterError(
      'ADAPTER_NORMALIZATION_FAILED',
      error instanceof Error ? error.message : 'Generic poll normalization failed',
      input.config.url
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

function buildUrl(input: GenericPollInput, pageToken?: string): string {
  const url = new URL(input.config.url);
  const cursorValue = input.cursor?.last_fetched_at ?? input.cursor?.last_source_id;

  if (input.config.cursor_query_param && cursorValue) {
    url.searchParams.set(input.config.cursor_query_param, String(cursorValue));
  }

  if (input.config.page_query_param && pageToken) {
    url.searchParams.set(input.config.page_query_param, pageToken);
  }

  return url.toString();
}

function readNextPageToken(body: unknown, config: GenericPollConfig): string | undefined {
  if (!config.next_page_response_path || !config.page_query_param) {
    return undefined;
  }

  const value = getPath(body, config.next_page_response_path);
  return typeof value === 'string' && value ? value : undefined;
}

function buildCanonicalRecord(rawRecord: unknown, config: GenericPollConfig): CanonicalTransaction {
  const record: Record<string, unknown> = {};

  for (const [canonicalPath, sourcePath] of Object.entries(config.field_mappings)) {
    const value = getPath(rawRecord, sourcePath);

    if (value !== undefined) {
      setPath(record, canonicalPath, value);
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

  for (const [metadataKey, sourcePath] of Object.entries(config.metadata_paths ?? {})) {
    const value = getPath(rawRecord, sourcePath);

    if (value !== undefined) {
      metadata[metadataKey] = value;
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

function buildCursor(
  body: unknown,
  rawRecords: unknown[],
  input: GenericPollInput
): GenericPollCursor {
  const cursorFromBody = input.config.cursor_response_path
    ? getPath(body, input.config.cursor_response_path)
    : undefined;

  if (isRecord(cursorFromBody)) {
    return cursorFromBody;
  }

  if (typeof cursorFromBody === 'string') {
    return {
      last_fetched_at: cursorFromBody
    };
  }

  const lastRecord = rawRecords.at(-1);
  const lastFetchedAt = input.config.next_cursor_record_path
    ? getPath(lastRecord, input.config.next_cursor_record_path)
    : undefined;

  if (typeof lastFetchedAt === 'string') {
    return {
      ...input.cursor,
      last_fetched_at: lastFetchedAt
    };
  }

  return input.cursor ?? {};
}

function getFetcher(input: GenericPollInput): GenericPollFetcher {
  if (input.fetcher) {
    return input.fetcher;
  }

  return async (url, init) => {
    const response = await fetch(url, init);

    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json() as Promise<unknown>
    };
  };
}

function getPath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }

    if (typeof current !== 'object') {
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
