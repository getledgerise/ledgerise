import { normalize } from '@ledgerise/adapter-inbound-generic-poll';
import { validateCanonicalTransaction } from '@ledgerise/core-schema';

import {
  expectedPollSummary,
  initialCursor,
  simplePollConfig,
  simplePollResponse
} from '../adapters/inbound/generic-poll/dist/fixtures/simple-api-response.js';

let requestedUrl;

const result = await normalize({
  cursor: initialCursor,
  config: simplePollConfig,
  fetcher: async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => simplePollResponse
    };
  }
});

if (result.status !== 'ok') {
  fail(`Expected ok result, got ${result.status}: ${result.message}`);
}

assertEqual(requestedUrl, expectedPollSummary.requested_url, 'requested url');
assertEqual(result.records.length, expectedPollSummary.records, 'record count');
assertEqual(result.records[0]?.source_id, expectedPollSummary.first_source_id, 'first source id');
assertEqual(result.cursor?.last_fetched_at, expectedPollSummary.next_cursor.last_fetched_at, 'cursor last_fetched_at');
assertEqual(result.cursor?.last_source_id, expectedPollSummary.next_cursor.last_source_id, 'cursor last_source_id');

for (const record of result.records) {
  const validation = validateCanonicalTransaction(record);

  if (!validation.valid) {
    fail(`Normalized record failed canonical validation: ${JSON.stringify(validation.errors)}`);
  }
}

const paginatedUrls = [];
const paginatedConfig = {
  ...simplePollConfig,
  page_query_param: 'page_token',
  next_page_response_path: 'data.next_page_token',
  max_pages: 3
};
const secondPollResponse = {
  data: {
    transactions: [
      {
        reference: 'POLL-20260601-0003',
        occurred_at: '2026-06-01T08:18:22Z',
        settled_at: '2026-06-01T08:18:35Z',
        status: 'settled',
        type: 'payment.data',
        direction: 'debit',
        amount: 200000,
        currency: 'NGN',
        channel: 'mobile',
        customer_id: 'usr_0000293',
        principal_type: 'customer',
        principal_reference: '080****4444',
        product_line: 'consumer-app',
        biller: 'mtn',
        biller_category: 'data',
        cursor_at: '2026-06-01T08:18:35Z'
      }
    ],
    next_cursor: {
      last_fetched_at: '2026-06-01T08:18:35Z',
      last_source_id: 'POLL-20260601-0003'
    }
  }
};

const paginatedResult = await normalize({
  cursor: initialCursor,
  config: paginatedConfig,
  fetcher: async (url) => {
    paginatedUrls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () =>
        paginatedUrls.length === 1
          ? {
              ...simplePollResponse,
              data: {
                ...simplePollResponse.data,
                next_page_token: 'page-2'
              }
            }
          : secondPollResponse
    };
  }
});

if (paginatedResult.status !== 'ok') {
  fail(`Expected paginated ok result, got ${paginatedResult.status}: ${paginatedResult.message}`);
}

assertEqual(paginatedUrls.length, 2, 'paginated request count');
assertEqual(
  paginatedUrls[1],
  'https://source.example.test/transactions?since=2026-06-01T08%3A00%3A00Z&page_token=page-2',
  'second page url'
);
assertEqual(paginatedResult.records.length, 3, 'paginated record count');
assertEqual(
  paginatedResult.cursor?.last_source_id,
  secondPollResponse.data.next_cursor.last_source_id,
  'paginated cursor last_source_id'
);

console.log('Generic poll verification passed.');
console.log(
  JSON.stringify(
    {
      records: result.records.length,
      first_source_id: result.records[0]?.source_id,
      next_cursor: result.cursor,
      paginated_records: paginatedResult.records.length
    },
    null,
    2
  )
);

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`Expected ${label} to be ${expected}, got ${actual}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
