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

console.log('Generic poll verification passed.');
console.log(
  JSON.stringify(
    {
      records: result.records.length,
      first_source_id: result.records[0]?.source_id,
      next_cursor: result.cursor
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
