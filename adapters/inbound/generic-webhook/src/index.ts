import { randomUUID } from 'node:crypto';

import {
  adapterError,
  ok,
  validationFailed,
  type AdapterHealthcheckResult,
  type AdapterMeta,
  type AdapterResult,
  type AdapterValidationError,
  type AdapterValidationResult
} from '@ledgerise/adapter-sdk';
import type { CanonicalTransaction } from '@ledgerise/canonical-types';
import { validateCanonicalTransaction } from '@ledgerise/core-schema';

import adapter from '../adapter.json' with { type: 'json' };

export interface GenericWebhookInput {
  payload: unknown;
  headers?: Record<string, string | string[] | undefined>;
  config: GenericWebhookConfig;
}

export interface GenericWebhookConfig {
  source_system: string;
  environment?: 'live' | 'test';
  field_mappings: Record<string, string>;
  defaults?: Record<string, unknown>;
  metadata_paths?: Record<string, string>;
  amount_multiplier?: number;
}

export function meta(): AdapterMeta {
  return adapter as AdapterMeta;
}

export function validate(input: GenericWebhookInput): AdapterValidationResult {
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

  if (!isRecord(input.payload)) {
    errors.push({
      field: 'payload',
      message: 'Payload must be a JSON object',
      raw_value: input.payload
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
  input: GenericWebhookInput
): Promise<AdapterResult<CanonicalTransaction>> {
  const inputValidation = validate(input);

  if (!inputValidation.valid) {
    return validationFailed('Generic webhook input failed validation', inputValidation.errors, input);
  }

  try {
    const record = buildCanonicalRecord(input);
    const outputValidation = validateCanonicalTransaction(record);

    if (!outputValidation.valid) {
      return validationFailed(
        'Generic webhook mapping did not produce a valid canonical transaction',
        outputValidation.errors.map((error) => ({
          field: error.fieldPath,
          message: error.message,
          raw_value: error.rawValue
        })),
        input.payload
      );
    }

    return ok([record]);
  } catch (error) {
    return adapterError(
      'ADAPTER_NORMALIZATION_FAILED',
      error instanceof Error ? error.message : 'Generic webhook normalization failed',
      input.payload
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

function buildCanonicalRecord(input: GenericWebhookInput): CanonicalTransaction {
  const record: Record<string, unknown> = {};

  for (const [canonicalPath, sourcePath] of Object.entries(input.config.field_mappings)) {
    const value = getPath(input.payload, sourcePath);

    if (value !== undefined) {
      setPath(record, canonicalPath, value);
    }
  }

  for (const [canonicalPath, value] of Object.entries(input.config.defaults ?? {})) {
    if (getPath(record, canonicalPath) === undefined) {
      setPath(record, canonicalPath, value);
    }
  }

  const metadata: Record<string, unknown> = isRecord(record.metadata)
    ? { ...record.metadata }
    : {};

  for (const [metadataKey, sourcePath] of Object.entries(input.config.metadata_paths ?? {})) {
    const value = getPath(input.payload, sourcePath);

    if (value !== undefined) {
      metadata[metadataKey] = value;
    }
  }

  record.id = randomUUID();
  record.processed_at = new Date().toISOString();
  record.source = {
    ...(isRecord(record.source) ? record.source : {}),
    adapter: meta().name,
    system: input.config.source_system,
    environment: input.config.environment ?? getPath(record, 'source.environment') ?? 'live'
  };
  record.metadata = metadata;

  if (typeof record.amount === 'number' && input.config.amount_multiplier) {
    record.amount = Math.round(record.amount * input.config.amount_multiplier);
  }

  return record as unknown as CanonicalTransaction;
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
