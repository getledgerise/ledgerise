import type {
  AdapterHealthcheckResult,
  AdapterMeta,
  AdapterValidationResult,
  OutboundJournalBatch,
  OutboundJournalPostResult
} from '@ledgerise/adapter-sdk';

import adapter from '../adapter.json' with { type: 'json' };

export function meta(): AdapterMeta {
  return adapter as AdapterMeta;
}

export function validate(input: OutboundJournalBatch): AdapterValidationResult {
  return {
    valid: Array.isArray(input.entries) && input.entries.length > 0,
    errors:
      Array.isArray(input.entries) && input.entries.length > 0
        ? []
        : [{ field: 'entries', message: 'At least one journal entry is required' }]
  };
}

export async function postJournals(input: OutboundJournalBatch): Promise<OutboundJournalPostResult> {
  return {
    status: 'error',
    batch_id: input.id,
    posted: [],
    failed: input.entries.map((entry) => ({
      journal_entry_id: entry.id,
      code: 'METHOD_NOT_SUPPORTED',
      message: 'Zoho Books posting is not implemented yet'
    }))
  };
}

export async function healthcheck(): Promise<AdapterHealthcheckResult> {
  const checkedAt = new Date().toISOString();
  const hasConfig = Boolean(process.env.ZOHO_BOOKS_ORGANIZATION_ID && process.env.ZOHO_BOOKS_ACCESS_TOKEN);

  if (!hasConfig) {
    return {
      status: 'error',
      code: 'AUTH_FAILED',
      message: 'Set ZOHO_BOOKS_ORGANIZATION_ID and ZOHO_BOOKS_ACCESS_TOKEN to enable Zoho Books posting',
      checked_at: checkedAt
    };
  }

  return {
    status: 'ok',
    latency_ms: 0,
    checked_at: checkedAt
  };
}
