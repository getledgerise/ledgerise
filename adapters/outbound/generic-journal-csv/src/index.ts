import type {
  AdapterHealthcheckResult,
  AdapterMeta,
  AdapterValidationError,
  AdapterValidationResult,
  OutboundJournalBatch,
  OutboundJournalPostResult
} from '@ledgerise/adapter-sdk';

import adapter from '../adapter.json' with { type: 'json' };

export function meta(): AdapterMeta {
  return adapter as AdapterMeta;
}

export function validate(input: OutboundJournalBatch): AdapterValidationResult {
  const errors: AdapterValidationError[] = [];

  if (!input.id) errors.push({ field: 'id', message: 'Batch id is required' });
  if (!input.operator_id) errors.push({ field: 'operator_id', message: 'Operator id is required' });
  if (!Array.isArray(input.entries)) {
    errors.push({ field: 'entries', message: 'Entries must be an array' });
    return { valid: false, errors };
  }

  input.entries.forEach((entry, entryIndex) => {
    const prefix = `entries.${entryIndex}`;
    if (!entry.id) errors.push({ field: `${prefix}.id`, message: 'Journal entry id is required' });
    if (!entry.transaction_id) {
      errors.push({ field: `${prefix}.transaction_id`, message: 'Transaction id is required' });
    }
    if (!entry.currency) errors.push({ field: `${prefix}.currency`, message: 'Currency is required' });
    if (!Array.isArray(entry.lines) || entry.lines.length < 2) {
      errors.push({ field: `${prefix}.lines`, message: 'At least two journal lines are required' });
      return;
    }

    const totals = new Map<string, { debit: number; credit: number }>();
    entry.lines.forEach((line, lineIndex) => {
      const linePrefix = `${prefix}.lines.${lineIndex}`;
      if (!line.account_code) {
        errors.push({ field: `${linePrefix}.account_code`, message: 'Account code is required' });
      }
      if (!['debit', 'credit'].includes(line.side)) {
        errors.push({ field: `${linePrefix}.side`, message: 'Side must be debit or credit' });
      }
      if (!Number.isInteger(line.amount) || line.amount <= 0) {
        errors.push({ field: `${linePrefix}.amount`, message: 'Amount must be a positive integer' });
      }
      if (!line.currency) {
        errors.push({ field: `${linePrefix}.currency`, message: 'Currency is required' });
      }

      const total = totals.get(line.currency) ?? { debit: 0, credit: 0 };
      total[line.side] += line.amount;
      totals.set(line.currency, total);
    });

    for (const [currency, total] of totals) {
      if (total.debit !== total.credit) {
        errors.push({
          field: `${prefix}.lines`,
          message: `Debits and credits do not balance for ${currency}`,
          raw_value: total
        });
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

export async function postJournals(input: OutboundJournalBatch): Promise<OutboundJournalPostResult> {
  const validation = validate(input);

  if (!validation.valid) {
    return {
      status: 'error',
      batch_id: input.id,
      posted: [],
      failed: input.entries.map((entry) => ({
        journal_entry_id: entry.id,
        code: 'VALIDATION_FAILED',
        message: validation.errors.map((error) => `${error.field}: ${error.message}`).join('; ')
      }))
    };
  }

  return {
    status: 'ok',
    batch_id: input.id,
    posted: input.entries.map((entry) => ({
      journal_entry_id: entry.id,
      external_reference: `csv:${input.id}:${entry.id}`
    })),
    failed: [],
    artifact: {
      content_type: 'text/csv',
      filename: `ledgerise-journal-${input.id}.csv`,
      content: toCsv(input)
    }
  };
}

export async function healthcheck(): Promise<AdapterHealthcheckResult> {
  return {
    status: 'ok',
    latency_ms: 0,
    checked_at: new Date().toISOString()
  };
}

function toCsv(input: OutboundJournalBatch): string {
  const rows = [
    [
      'batch_id',
      'journal_entry_id',
      'transaction_id',
      'source_id',
      'generated_at',
      'entry_type',
      'transaction_type',
      'product_line',
      'product_biller',
      'currency',
      'journal_amount',
      'line_order',
      'side',
      'account_code',
      'line_amount',
      'mapping_rule_id',
      'mapping_rule_version'
    ]
  ];

  for (const entry of input.entries) {
    for (const line of entry.lines) {
      rows.push([
        input.id,
        entry.id,
        entry.transaction_id,
        entry.source_id ?? '',
        entry.generated_at,
        entry.entry_type,
        entry.transaction_type ?? '',
        entry.product_line ?? '',
        entry.product_biller ?? '',
        entry.currency,
        String(entry.amount),
        String(line.line_order),
        line.side,
        line.account_code,
        String(line.amount),
        entry.mapping_rule_id ?? '',
        entry.mapping_rule_version === undefined ? '' : String(entry.mapping_rule_version)
      ]);
    }
  }

  return `${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}\n`;
}

function escapeCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
