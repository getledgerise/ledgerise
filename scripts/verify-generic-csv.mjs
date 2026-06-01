import { normalize } from '@ledgerise/adapter-inbound-generic-csv';
import { validateCanonicalTransaction } from '@ledgerise/core-schema';

import {
  expectedMixedBillPaymentSummary,
  mixedBillPaymentsConfig,
  mixedBillPaymentsCsv
} from '../adapters/inbound/generic-csv/dist/fixtures/mixed-bill-payments.js';

const result = await normalize({
  content: mixedBillPaymentsCsv,
  filename: 'mixed-bill-payments.csv',
  config: mixedBillPaymentsConfig
});

if (result.status !== 'ok') {
  fail(`Expected ok result, got ${result.status}: ${result.message}`);
}

assertEqual(result.records.length, expectedMixedBillPaymentSummary.valid_records, 'valid record count');
assertEqual(result.row_errors?.length ?? 0, expectedMixedBillPaymentSummary.row_errors, 'row error count');
assertEqual(result.records[0]?.source_id, expectedMixedBillPaymentSummary.first_source_id, 'first source id');
assertEqual(result.row_errors?.[0]?.row, expectedMixedBillPaymentSummary.bad_row, 'bad row number');

for (const record of result.records) {
  const validation = validateCanonicalTransaction(record);

  if (!validation.valid) {
    fail(`Normalized record failed canonical validation: ${JSON.stringify(validation.errors)}`);
  }
}

console.log('Generic CSV verification passed.');
console.log(
  JSON.stringify(
    {
      records: result.records.length,
      row_errors: result.row_errors?.length ?? 0,
      first_source_id: result.records[0]?.source_id
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
