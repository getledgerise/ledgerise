import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import { simplePollConfig } from '../adapters/inbound/generic-poll/dist/fixtures/simple-api-response.js';
import { runGenericPollOnce } from '../apps/worker/dist/index.js';
import { PostgresIngestionRepository } from '../core/ingestion/dist/postgres.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/ledgerise';
const apiPort = process.env.VERIFY_API_PORT ?? '3299';
const baseUrl = `http://127.0.0.1:${apiPort}`;
const adapterName = 'generic-poll';
const sourceSystem = `poll-safety-${Date.now()}`;
const cursorOne = {
  last_fetched_at: '2026-06-01T08:16:35Z',
  last_source_id: `${sourceSystem}-0002`
};

const repository = new PostgresIngestionRepository({ connectionString: databaseUrl });
let originalConfiguration;

try {
  const operatorId =
    process.env.DEFAULT_OPERATOR_ID ??
    (await repository.findOperatorIdBySlug(process.env.DEFAULT_OPERATOR_SLUG ?? 'local-operator'));

  if (!operatorId) {
    throw new Error('No operator found for poll cursor verification');
  }

  const config = {
    ...simplePollConfig,
    source_system: sourceSystem
  };
  const response = buildPollResponse(sourceSystem, cursorOne);
  originalConfiguration = await repository.findAdapterConfiguration({ operatorId, adapterName });

  await repository.saveAdapterConfiguration({
    operatorId,
    adapterName,
    enabled: true,
    config
  });

  const firstRun = await runGenericPollOnce({
    ingestionRepository: repository,
    operatorId,
    adapterName,
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => response
    })
  });

  assertEqual(firstRun.run.status, 'succeeded', 'first run status');
  assertEqual(firstRun.run.acceptedCount, 2, 'first run accepted count');
  assertEqual(firstRun.run.duplicateCount, 0, 'first run duplicate count');

  const advancedCursor = await repository.findPollCursor({ operatorId, adapterName });
  assertEqual(
    advancedCursor?.cursor.last_fetched_at,
    cursorOne.last_fetched_at,
    'cursor advanced after success'
  );
  assertEqual(
    advancedCursor?.cursor.last_source_id,
    cursorOne.last_source_id,
    'cursor source id advanced after success'
  );

  const failedRun = await runGenericPollOnce({
    ingestionRepository: repository,
    operatorId,
    adapterName,
    fetcher: async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    })
  });

  assertEqual(failedRun.run.status, 'failed', 'failed source run status');

  const cursorAfterFailure = await repository.findPollCursor({ operatorId, adapterName });
  assertEqual(
    cursorAfterFailure?.cursor.last_fetched_at,
    cursorOne.last_fetched_at,
    'cursor preserved after failure'
  );
  assertEqual(
    cursorAfterFailure?.cursor.last_source_id,
    cursorOne.last_source_id,
    'cursor source id preserved after failure'
  );

  const duplicateRun = await runGenericPollOnce({
    ingestionRepository: repository,
    operatorId,
    adapterName,
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => response
    })
  });

  assertEqual(duplicateRun.run.status, 'succeeded', 'duplicate rerun status');
  assertEqual(duplicateRun.run.acceptedCount, 0, 'duplicate rerun accepted count');
  assertEqual(duplicateRun.run.duplicateCount, 2, 'duplicate rerun duplicate count');

  const transactions = await repository.listTransactions({
    operatorId,
    adapter: adapterName,
    occurredFrom: '2026-06-01T08:00:00Z',
    occurredTo: '2026-06-01T09:00:00Z',
    limit: 100
  });
  const sourceRecords = transactions.records.filter(
    (transaction) => transaction.record.source.system === sourceSystem
  );

  assertEqual(sourceRecords.length, 2, 'duplicate rerun did not add transactions');

  const api = spawn('node', ['apps/api/dist/index.js'], {
    env: {
      ...process.env,
      API_PORT: apiPort,
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
    await waitForHealthcheck(api);
    const pollStatus = await getJson('/api/adapters/generic-poll/poll-status?limit=3');
    assertEqual(pollStatus.statusCode, 200, 'poll status endpoint status');
    assertEqual(pollStatus.body.adapter_name, adapterName, 'poll status adapter name');
    assertEqual(pollStatus.body.cursor.cursor.last_fetched_at, cursorOne.last_fetched_at, 'poll status cursor');
    assertEqual(pollStatus.body.runs.length, 3, 'poll status run count');
    assertEqual(pollStatus.body.runs[0].status, 'succeeded', 'poll status latest run');
  } catch (error) {
    if (apiOutput.trim()) {
      console.error('\nAPI output:');
      console.error(apiOutput.trim());
    }
    throw error;
  } finally {
    api.kill();
  }

  console.log('Poll cursor safety verification passed.');
  console.log(
    JSON.stringify(
      {
        source_system: sourceSystem,
        first_run_id: firstRun.run.id,
        failed_run_id: failedRun.run.id,
        duplicate_run_id: duplicateRun.run.id,
        cursor: cursorAfterFailure?.cursor,
        transactions: sourceRecords.length
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('Poll cursor safety verification failed.');
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
} finally {
  if (originalConfiguration) {
    await repository.saveAdapterConfiguration({
      operatorId: originalConfiguration.operatorId,
      adapterName: originalConfiguration.name,
      enabled: originalConfiguration.enabled,
      config: originalConfiguration.config
    });
  }

  await repository.close();
}

function buildPollResponse(sourceSystem, cursor) {
  return {
    data: {
      transactions: [
        {
          reference: `${sourceSystem}-0001`,
          occurred_at: '2026-06-01T08:14:22Z',
          settled_at: '2026-06-01T08:14:35Z',
          status: 'settled',
          type: 'payment.electricity',
          direction: 'debit',
          amount: 500000,
          currency: 'NGN',
          channel: 'mobile',
          customer_id: `usr_${randomUUID()}`,
          principal_type: 'customer',
          principal_reference: '08000000001',
          product_line: 'consumer-app',
          biller: 'ikeja-electric',
          biller_category: 'electricity',
          cursor_at: '2026-06-01T08:14:35Z'
        },
        {
          reference: `${sourceSystem}-0002`,
          occurred_at: '2026-06-01T08:16:22Z',
          settled_at: '2026-06-01T08:16:35Z',
          status: 'settled',
          type: 'payment.airtime',
          direction: 'debit',
          amount: 100000,
          currency: 'NGN',
          channel: 'mobile',
          customer_id: `usr_${randomUUID()}`,
          principal_type: 'customer',
          principal_reference: '08000000002',
          product_line: 'consumer-app',
          biller: 'mtn',
          biller_category: 'airtime',
          cursor_at: '2026-06-01T08:16:35Z'
        }
      ],
      next_cursor: cursor
    }
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${label}. Expected ${expected}, got ${actual}`);
  }
}

async function waitForHealthcheck(api) {
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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
