import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv/dist/ajv.js';
import * as addFormatsModule from 'ajv-formats/dist/index.js';

import type { CanonicalTransaction } from '@ledgerise/canonical-types';

export interface CanonicalValidationError {
  fieldPath: string;
  message: string;
  rawValue?: unknown;
  keyword: string;
}

export interface CanonicalValidationResult {
  valid: boolean;
  errors: CanonicalValidationError[];
}

const schemaUrl = new URL('../../../schemas/transaction.schema.json', import.meta.url);
const transactionSchema = JSON.parse(readFileSync(fileURLToPath(schemaUrl), 'utf8')) as Record<string, unknown>;

const addFormats = addFormatsModule.default as unknown as (ajv: Ajv) => Ajv;

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false
});

addFormats(ajv);

const validateTransactionSchema: ValidateFunction = ajv.compile(transactionSchema);

export function validateCanonicalTransaction(input: unknown): CanonicalValidationResult {
  const valid = validateTransactionSchema(input);

  if (valid) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: (validateTransactionSchema.errors ?? []).map((error) => toValidationError(error, input))
  };
}

export function assertCanonicalTransaction(input: unknown): asserts input is CanonicalTransaction {
  const result = validateCanonicalTransaction(input);

  if (!result.valid) {
    throw new CanonicalTransactionValidationError(result.errors);
  }
}

export function isCanonicalTransaction(input: unknown): input is CanonicalTransaction {
  return validateCanonicalTransaction(input).valid;
}

export function getCanonicalTransactionSchema(): Record<string, unknown> {
  return transactionSchema;
}

export class CanonicalTransactionValidationError extends Error {
  readonly errors: CanonicalValidationError[];

  constructor(errors: CanonicalValidationError[]) {
    super('Canonical transaction validation failed');
    this.name = 'CanonicalTransactionValidationError';
    this.errors = errors;
  }
}

function toValidationError(error: ErrorObject, input: unknown): CanonicalValidationError {
  const fieldPath = getFieldPath(error);

  return {
    fieldPath,
    message: error.message ?? 'Invalid value',
    rawValue: getValueAtPath(input, fieldPath),
    keyword: error.keyword
  };
}

function getFieldPath(error: ErrorObject): string {
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    const parentPath = pointerToDotPath(error.instancePath);
    return parentPath ? `${parentPath}.${error.params.missingProperty}` : error.params.missingProperty;
  }

  if (
    error.keyword === 'additionalProperties' &&
    typeof error.params.additionalProperty === 'string'
  ) {
    const parentPath = pointerToDotPath(error.instancePath);
    return parentPath ? `${parentPath}.${error.params.additionalProperty}` : error.params.additionalProperty;
  }

  return pointerToDotPath(error.instancePath);
}

function pointerToDotPath(pointer: string): string {
  if (!pointer) {
    return '$';
  }

  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .join('.');
}

function getValueAtPath(input: unknown, fieldPath: string): unknown {
  if (fieldPath === '$') {
    return input;
  }

  return fieldPath.split('.').reduce<unknown>((value, key) => {
    if (value === null || typeof value !== 'object') {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, input);
}
