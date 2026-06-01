import type { GenericPollConfig, GenericPollCursor } from '../src/index.js';

export const simplePollResponse = {
  data: {
    transactions: [
      {
        reference: 'POLL-20260601-0001',
        occurred_at: '2026-06-01T08:14:22Z',
        settled_at: '2026-06-01T08:14:35Z',
        status: 'settled',
        type: 'payment.electricity',
        direction: 'debit',
        amount: 500000,
        currency: 'NGN',
        channel: 'mobile',
        customer_id: 'usr_0000291',
        principal_type: 'customer',
        principal_reference: '080****4421',
        product_line: 'consumer-app',
        biller: 'ikeja-electric',
        biller_category: 'electricity',
        cursor_at: '2026-06-01T08:14:35Z'
      },
      {
        reference: 'POLL-20260601-0002',
        occurred_at: '2026-06-01T08:16:22Z',
        settled_at: '2026-06-01T08:16:35Z',
        status: 'settled',
        type: 'payment.airtime',
        direction: 'debit',
        amount: 100000,
        currency: 'NGN',
        channel: 'mobile',
        customer_id: 'usr_0000292',
        principal_type: 'customer',
        principal_reference: '080****4433',
        product_line: 'consumer-app',
        biller: 'mtn',
        biller_category: 'airtime',
        cursor_at: '2026-06-01T08:16:35Z'
      }
    ],
    next_cursor: {
      last_fetched_at: '2026-06-01T08:16:35Z',
      last_source_id: 'POLL-20260601-0002'
    }
  }
};

export const simplePollConfig: GenericPollConfig = {
  url: 'https://source.example.test/transactions',
  records_path: 'data.transactions',
  cursor_response_path: 'data.next_cursor',
  cursor_query_param: 'since',
  source_system: 'simple-json-api',
  environment: 'live',
  field_mappings: {
    source_id: 'reference',
    occurred_at: 'occurred_at',
    settled_at: 'settled_at',
    status: 'status',
    type: 'type',
    direction: 'direction',
    amount: 'amount',
    currency: 'currency',
    channel: 'channel',
    'principal.id': 'customer_id',
    'principal.type': 'principal_type',
    'principal.reference': 'principal_reference',
    'product.line': 'product_line',
    'product.biller': 'biller',
    'product.biller_category': 'biller_category'
  },
  metadata_paths: {
    cursor_at: 'cursor_at'
  }
};

export const initialCursor: GenericPollCursor = {
  last_fetched_at: '2026-06-01T08:00:00Z',
  last_source_id: 'POLL-20260601-0000'
};

export const expectedPollSummary = {
  records: 2,
  first_source_id: 'POLL-20260601-0001',
  next_cursor: {
    last_fetched_at: '2026-06-01T08:16:35Z',
    last_source_id: 'POLL-20260601-0002'
  },
  requested_url: 'https://source.example.test/transactions?since=2026-06-01T08%3A00%3A00Z'
};
