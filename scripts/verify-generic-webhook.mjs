import { validateCanonicalTransaction } from '@ledgerise/core-schema';
import { normalize } from '@ledgerise/adapter-inbound-generic-webhook';

import {
  expectedCanonicalFields,
  validBillPaymentConfig,
  validBillPaymentPayload
} from '../adapters/inbound/generic-webhook/dist/fixtures/valid-bill-payment.js';

const result = await normalize({
  payload: validBillPaymentPayload,
  config: validBillPaymentConfig
});

if (result.status !== 'ok') {
  fail(`Expected ok result, got ${result.status}: ${result.message}`);
}

if (result.records.length !== 1) {
  fail(`Expected 1 normalized record, got ${result.records.length}`);
}

const [record] = result.records;

if (!record) {
  fail('Normalized record is missing');
}

const validation = validateCanonicalTransaction(record);

if (!validation.valid) {
  fail(`Normalized record failed canonical validation: ${JSON.stringify(validation.errors)}`);
}

assertEqual(record.source_id, expectedCanonicalFields.source_id, 'source_id');
assertEqual(record.source.adapter, expectedCanonicalFields.source.adapter, 'source.adapter');
assertEqual(record.source.system, expectedCanonicalFields.source.system, 'source.system');
assertEqual(record.source.environment, expectedCanonicalFields.source.environment, 'source.environment');
assertEqual(record.status, expectedCanonicalFields.status, 'status');
assertEqual(record.type, expectedCanonicalFields.type, 'type');
assertEqual(record.direction, expectedCanonicalFields.direction, 'direction');
assertEqual(record.amount, expectedCanonicalFields.amount, 'amount');
assertEqual(record.currency, expectedCanonicalFields.currency, 'currency');
assertEqual(record.channel, expectedCanonicalFields.channel, 'channel');
assertEqual(record.product.line, expectedCanonicalFields.product.line, 'product.line');
assertEqual(record.product.biller, expectedCanonicalFields.product.biller, 'product.biller');
assertEqual(
  record.product.biller_category,
  expectedCanonicalFields.product.biller_category,
  'product.biller_category'
);

console.log('Generic webhook verification passed.');
console.log(
  JSON.stringify(
    {
      transaction_id: record.id,
      source_id: record.source_id,
      adapter: record.source.adapter
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
