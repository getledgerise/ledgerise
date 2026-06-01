import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import {
  invalidCanonicalTransactions,
  settledBillPayment
} from '@ledgerise/test-fixtures';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/ledgerise';
const port = process.env.VERIFY_API_PORT ?? '3199';
const baseUrl = `http://127.0.0.1:${port}`;

const transactionId = randomUUID();
const sourceId = `VERIFY-${Date.now()}`;
const concurrentSourceId = `${sourceId}-CONCURRENT`;
const validRecord = {
  ...settledBillPayment,
  id: transactionId,
  source_id: sourceId
};
const invalidRecord = {
  ...invalidCanonicalTransactions.invalidStatus,
  id: randomUUID(),
  source_id: `${sourceId}-INVALID`
};

const api = spawn('node', ['apps/api/dist/index.js'], {
  env: {
    ...process.env,
    API_PORT: port,
    DATABASE_URL: databaseUrl,
    DEFAULT_OPERATOR_SLUG: process.env.DEFAULT_OPERATOR_SLUG ?? 'local-operator'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let apiOutput = '';

api.stdout.on('data', (chunk) => {
  apiOutput += chunk.toString();
});

api.stderr.on('data', (chunk) => {
  apiOutput += chunk.toString();
});

try {
  await waitForHealthcheck();

  const healthcheck = await getJson('/healthcheck');
  assertEqual(healthcheck.statusCode, 200, 'healthcheck status');
  assertEqual(healthcheck.body.repository, 'postgres', 'healthcheck repository');

  const accepted = await postJson('/api/ingest/generic-webhook', validRecord);
  assertEqual(accepted.statusCode, 202, 'valid ingest status');
  assertEqual(accepted.body.status, 'accepted', 'valid ingest result');
  assertEqual(accepted.body.transaction_id, transactionId, 'valid ingest transaction id');

  const duplicate = await postJson('/api/ingest/generic-webhook', validRecord);
  assertEqual(duplicate.statusCode, 202, 'duplicate ingest status');
  assertEqual(duplicate.body.status, 'duplicate', 'duplicate ingest result');
  assertEqual(duplicate.body.transaction_id, transactionId, 'duplicate transaction id');

  const rejected = await postJson('/api/ingest/generic-webhook', invalidRecord);
  assertEqual(rejected.statusCode, 422, 'invalid ingest status');
  assertEqual(rejected.body.status, 'rejected', 'invalid ingest result');

  const concurrentRecords = [
    {
      ...settledBillPayment,
      id: randomUUID(),
      source_id: concurrentSourceId
    },
    {
      ...settledBillPayment,
      id: randomUUID(),
      source_id: concurrentSourceId
    }
  ];
  const concurrentResults = await Promise.all(
    concurrentRecords.map((record) => postJson('/api/ingest/generic-webhook', record))
  );
  assert(
    concurrentResults.every((result) => result.statusCode === 202),
    'concurrent duplicate requests return accepted HTTP status'
  );
  assertEqual(
    concurrentResults.filter((result) => result.body.status === 'accepted').length,
    1,
    'concurrent duplicate accepted count'
  );
  assertEqual(
    concurrentResults.filter((result) => result.body.status === 'duplicate').length,
    1,
    'concurrent duplicate marker count'
  );

  const transactions = await getJson('/api/transactions');
  assertEqual(transactions.statusCode, 200, 'transaction list status');
  assertEqual(typeof transactions.body.page.total, 'number', 'transaction list total type');
  assert(
    transactions.body.records.some((record) => record.id === transactionId),
    'transaction list includes verified record'
  );

  const filteredTransactions = await getJson(
    `/api/transactions?status=settled&adapter=generic-webhook&product_line=consumer-app&limit=1&offset=0`
  );
  assertEqual(filteredTransactions.statusCode, 200, 'filtered transaction list status');
  assertEqual(filteredTransactions.body.page.limit, 1, 'filtered transaction list limit');
  assert(
    filteredTransactions.body.records.every(
      (record) =>
        record.status === 'settled' &&
        record.source.adapter === 'generic-webhook' &&
        record.product.line === 'consumer-app'
    ),
    'filtered transaction list applies filters'
  );

  const detail = await getJson(`/api/transactions/${transactionId}`);
  assertEqual(detail.statusCode, 200, 'transaction detail status');
  assertEqual(detail.body.record.id, transactionId, 'transaction detail id');

  const errors = await getJson('/api/ingestion-errors');
  assertEqual(errors.statusCode, 200, 'ingestion error list status');
  assertEqual(typeof errors.body.page.total, 'number', 'ingestion error list total type');
  assert(
    errors.body.records.some((record) => record.source_id === sourceId),
    'ingestion errors include duplicate marker'
  );
  assert(
    errors.body.records.some((record) => record.source_id === `${sourceId}-INVALID`),
    'ingestion errors include invalid marker'
  );

  const filteredErrors = await getJson('/api/ingestion-errors?error_type=duplicate_source&limit=1');
  assertEqual(filteredErrors.statusCode, 200, 'filtered ingestion error list status');
  assertEqual(filteredErrors.body.page.limit, 1, 'filtered ingestion error list limit');
  assert(
    filteredErrors.body.records.every((record) => record.error_type === 'duplicate_source'),
    'filtered ingestion error list applies filters'
  );

  console.log('PostgreSQL ingestion verification passed.');
  console.log(
    JSON.stringify(
      {
        transaction_id: transactionId,
        source_id: sourceId,
        concurrent_source_id: concurrentSourceId,
        duplicate_marker_id: duplicate.body.marker_id,
        invalid_error_id: rejected.body.error_id
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('PostgreSQL ingestion verification failed.');
  console.error(error instanceof Error ? error.message : error);
  if (apiOutput.trim()) {
    console.error('\nAPI output:');
    console.error(apiOutput.trim());
  }
  process.exitCode = 1;
} finally {
  api.kill();
}

async function waitForHealthcheck() {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < 10_000) {
    if (api.exitCode !== null) {
      throw new Error(`API process exited early with code ${api.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/healthcheck`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for API healthcheck${lastError ? `: ${String(lastError)}` : ''}`
  );
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    statusCode: response.status,
    body: await response.json()
  };
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return {
    statusCode: response.status,
    body: await response.json()
  };
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${label}. Expected ${expected}, got ${actual}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
