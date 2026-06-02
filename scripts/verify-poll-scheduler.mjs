import {
  getNextGenericPollDelayMs,
  startGenericPollScheduler
} from '../apps/worker/dist/index.js';

assertEqual(
  getNextGenericPollDelayMs({
    intervalMs: 1000,
    retryBaseDelayMs: 100,
    maxRetryDelayMs: 500,
    consecutiveFailures: 0
  }),
  1000,
  'successful run delay'
);
assertEqual(
  getNextGenericPollDelayMs({
    intervalMs: 1000,
    retryBaseDelayMs: 100,
    maxRetryDelayMs: 500,
    consecutiveFailures: 1
  }),
  100,
  'first retry delay'
);
assertEqual(
  getNextGenericPollDelayMs({
    intervalMs: 1000,
    retryBaseDelayMs: 100,
    maxRetryDelayMs: 500,
    consecutiveFailures: 4
  }),
  500,
  'retry delay cap'
);

const statuses = ['failed', 'failed', 'succeeded'];
const callTimes = [];
const activeCounts = [];
const logs = [];
let activeRuns = 0;

const scheduler = startGenericPollScheduler({
  intervalMs: 40,
  retryBaseDelayMs: 5,
  maxRetryDelayMs: 20,
  logger: {
    log: (message) => logs.push(message),
    error: (message) => logs.push(String(message))
  },
  run: async () => {
    activeRuns += 1;
    activeCounts.push(activeRuns);
    callTimes.push(Date.now());
    await sleep(8);
    activeRuns -= 1;

    const status = statuses[Math.min(callTimes.length - 1, statuses.length - 1)];
    return {
      run: {
        id: `scheduler-run-${callTimes.length}`,
        operatorId: 'operator_1',
        adapterName: 'generic-poll',
        status,
        previousCursor: {},
        nextCursor: {},
        recordsFetched: callTimes.length,
        acceptedCount: status === 'succeeded' ? 1 : 0,
        duplicateCount: 0,
        rejectedCount: 0,
        errorMessage: status === 'failed' ? 'source unavailable' : undefined,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString()
      }
    };
  }
});

try {
  await waitFor(() => callTimes.length >= 3, 1000, 'scheduler to execute three runs');
  scheduler.stop();

  assertEqual(callTimes.length, 3, 'scheduled run count');
  assert(
    activeCounts.every((count) => count === 1),
    'scheduler does not overlap poll attempts'
  );
  assert(
    callTimes[1] - callTimes[0] >= 5,
    'first failed run uses retry delay before next run'
  );
  assert(
    callTimes[2] - callTimes[1] >= 10,
    'second failed run uses exponential retry delay before next run'
  );
  assert(
    logs.some((entry) => entry.includes('"next_retry_delay_ms": 5')),
    'scheduler logs first retry delay'
  );

  console.log('Poll scheduler verification passed.');
  console.log(
    JSON.stringify(
      {
        runs: callTimes.length,
        first_retry_delay_ms: callTimes[1] - callTimes[0],
        second_retry_delay_ms: callTimes[2] - callTimes[1]
      },
      null,
      2
    )
  );
} catch (error) {
  scheduler.stop();
  console.error('Poll scheduler verification failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await sleep(5);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
