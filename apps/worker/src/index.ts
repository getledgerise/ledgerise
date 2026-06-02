import { pathToFileURL } from 'node:url';

import {
  normalize as normalizeGenericPoll,
  type GenericPollConfig,
  type GenericPollCursor,
  type GenericPollFetcher
} from '@ledgerise/adapter-inbound-generic-poll';
import { JournalEngineService } from '@ledgerise/core-engine';
import { PostgresJournalEngineRepository } from '@ledgerise/core-engine/postgres';
import {
  IngestionService,
  type IngestionRepository,
  type StoredPollRun
} from '@ledgerise/core-ingestion';
import { PostgresIngestionRepository } from '@ledgerise/core-ingestion/postgres';

await mainIfEntrypoint();

export interface RunGenericPollOnceInput {
  ingestionRepository: IngestionRepository;
  operatorId: string;
  adapterName?: string;
  config?: GenericPollConfig;
  fetcher?: GenericPollFetcher;
}

export interface RunGenericPollOnceResult {
  run: StoredPollRun;
}

export interface GenericPollSchedulerInput {
  run: () => Promise<RunGenericPollOnceResult>;
  intervalMs: number;
  retryBaseDelayMs: number;
  maxRetryDelayMs: number;
  runImmediately?: boolean;
  logger?: Pick<typeof console, 'error' | 'log'>;
}

export interface GenericPollScheduler {
  stop(): void;
}

export async function runGenericPollOnce(
  input: RunGenericPollOnceInput
): Promise<RunGenericPollOnceResult> {
  const adapterName = input.adapterName ?? 'generic-poll';
  const config =
    input.config ??
    (await loadGenericPollConfig(input.ingestionRepository, input.operatorId, adapterName));
  const cursorState = await input.ingestionRepository.findPollCursor({
    operatorId: input.operatorId,
    adapterName
  });
  const previousCursor = cursorState?.cursor ?? {};
  const run = await input.ingestionRepository.createPollRun({
    operatorId: input.operatorId,
    adapterName,
    previousCursor
  });
  const ingestionService = new IngestionService(input.ingestionRepository);
  const counts = {
    recordsFetched: 0,
    acceptedCount: 0,
    duplicateCount: 0,
    rejectedCount: 0
  };

  try {
    const result = await normalizeGenericPoll({
      cursor: previousCursor as GenericPollCursor,
      config,
      fetcher: input.fetcher
    });

    if (result.status !== 'ok') {
      throw new Error(`Generic poll failed: ${result.message}`);
    }

    counts.recordsFetched = result.records.length;

    if (result.row_errors?.length) {
      throw new Error(`Generic poll returned ${result.row_errors.length} row error(s)`);
    }

    for (const record of result.records) {
      const ingestResult = await ingestionService.ingestCanonicalTransaction({
        operatorId: input.operatorId,
        adapterName,
        record
      });

      if (ingestResult.status === 'accepted') {
        counts.acceptedCount += 1;
        continue;
      }

      if (ingestResult.status === 'duplicate') {
        counts.duplicateCount += 1;
        continue;
      }

      counts.rejectedCount += 1;
      throw new Error(`Poll record ${record.source_id ?? record.id} was rejected`);
    }

    const nextCursor = toCursorRecord(result.cursor) ?? previousCursor;
    const finishedRun = await input.ingestionRepository.finishPollRun({
      operatorId: input.operatorId,
      adapterName,
      runId: run.id,
      status: 'succeeded',
      nextCursor,
      advanceCursor: true,
      ...counts
    });

    return { run: finishedRun };
  } catch (error) {
    const finishedRun = await input.ingestionRepository.finishPollRun({
      operatorId: input.operatorId,
      adapterName,
      runId: run.id,
      status: 'failed',
      nextCursor: previousCursor,
      advanceCursor: false,
      ...counts,
      errorMessage: error instanceof Error ? error.message : 'Generic poll run failed'
    });

    return { run: finishedRun };
  }
}

export function startGenericPollScheduler(input: GenericPollSchedulerInput): GenericPollScheduler {
  const logger = input.logger ?? console;
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let consecutiveFailures = 0;

  const scheduleNext = (delayMs: number) => {
    if (stopped) {
      return;
    }

    timeout = setTimeout(() => {
      void runScheduledPoll();
    }, delayMs);
  };

  const runScheduledPoll = async () => {
    if (stopped) {
      return;
    }

    try {
      const result = await input.run();
      const failed = result.run.status === 'failed';
      consecutiveFailures = failed ? consecutiveFailures + 1 : 0;

      logger.log(
        JSON.stringify(
          {
            event: 'generic_poll_run',
            run_id: result.run.id,
            status: result.run.status,
            records_fetched: result.run.recordsFetched,
            accepted: result.run.acceptedCount,
            duplicates: result.run.duplicateCount,
            rejected: result.run.rejectedCount,
            next_retry_delay_ms: failed
              ? getNextGenericPollDelayMs({
                  intervalMs: input.intervalMs,
                  retryBaseDelayMs: input.retryBaseDelayMs,
                  maxRetryDelayMs: input.maxRetryDelayMs,
                  consecutiveFailures
                })
              : undefined
          },
          null,
          2
        )
      );
    } catch (error) {
      consecutiveFailures += 1;
      logger.error(error instanceof Error ? error.message : 'Scheduled generic poll failed');
    } finally {
      scheduleNext(
        getNextGenericPollDelayMs({
          intervalMs: input.intervalMs,
          retryBaseDelayMs: input.retryBaseDelayMs,
          maxRetryDelayMs: input.maxRetryDelayMs,
          consecutiveFailures
        })
      );
    }
  };

  scheduleNext(input.runImmediately === false ? input.intervalMs : 0);

  return {
    stop() {
      stopped = true;
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };
}

export function getNextGenericPollDelayMs(input: {
  intervalMs: number;
  retryBaseDelayMs: number;
  maxRetryDelayMs: number;
  consecutiveFailures: number;
}): number {
  if (input.consecutiveFailures <= 0) {
    return input.intervalMs;
  }

  return Math.min(
    input.retryBaseDelayMs * 2 ** (input.consecutiveFailures - 1),
    input.maxRetryDelayMs
  );
}

async function loadGenericPollConfig(
  repository: IngestionRepository,
  operatorId: string,
  adapterName: string
): Promise<GenericPollConfig> {
  const configuration = await repository.findAdapterConfiguration({ operatorId, adapterName });

  if (!configuration?.enabled) {
    throw new Error(`Adapter "${adapterName}" is not configured or enabled`);
  }

  if (!isGenericPollConfig(configuration.config)) {
    throw new Error(`Adapter "${adapterName}" does not have a valid generic poll config`);
  }

  return configuration.config;
}

async function resolveOperatorId(
  ingestionRepository: PostgresIngestionRepository,
  runDescription: string
): Promise<string> {
  const operatorId =
    process.env.DEFAULT_OPERATOR_ID ??
    (await ingestionRepository.findOperatorIdBySlug(
      process.env.DEFAULT_OPERATOR_SLUG ?? 'local-operator'
    ));

  if (!operatorId) {
    throw new Error(`No operator found for ${runDescription}`);
  }

  return operatorId;
}

function toCursorRecord(cursor: unknown): Record<string, unknown> | undefined {
  return isRecord(cursor) ? cursor : undefined;
}

function isGenericPollConfig(input: unknown): input is GenericPollConfig {
  return (
    isRecord(input) &&
    typeof input.url === 'string' &&
    typeof input.records_path === 'string' &&
    typeof input.source_system === 'string' &&
    isRecord(input.field_mappings)
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

async function mainIfEntrypoint(): Promise<void> {
  if (!process.argv[1] || import.meta.url !== pathToFileURL(process.argv[1]).href) {
    return;
  }

  const schedule = process.env.ENGINE_SCHEDULE_CRON ?? '0 * * * *';
  const databaseUrl = process.env.DATABASE_URL;

  console.log(`Ledgerise worker ready. Engine schedule: ${schedule}.`);
  let pollRanOnStart = false;

  if (process.env.RUN_GENERIC_POLL_ON_START === 'true') {
    if (!databaseUrl) {
      throw new Error('RUN_GENERIC_POLL_ON_START requires DATABASE_URL');
    }

    const ingestionRepository = new PostgresIngestionRepository({ connectionString: databaseUrl });

    try {
      const operatorId = await resolveOperatorId(ingestionRepository, 'poll run');
      const result = await runGenericPollOnce({
        ingestionRepository,
        operatorId,
        adapterName: process.env.GENERIC_POLL_ADAPTER_NAME ?? 'generic-poll'
      });

      console.log(
        JSON.stringify(
          {
            run_id: result.run.id,
            status: result.run.status,
            records_fetched: result.run.recordsFetched,
            accepted: result.run.acceptedCount,
            duplicates: result.run.duplicateCount,
            rejected: result.run.rejectedCount,
            cursor: result.run.nextCursor
          },
          null,
          2
        )
      );

      if (result.run.status === 'failed') {
        throw new Error(result.run.errorMessage ?? 'Generic poll run failed');
      }

      pollRanOnStart = true;
    } finally {
      await ingestionRepository.close();
    }
  }

  if (process.env.RUN_GENERIC_POLL_SCHEDULE === 'true') {
    if (!databaseUrl) {
      throw new Error('RUN_GENERIC_POLL_SCHEDULE requires DATABASE_URL');
    }

    const ingestionRepository = new PostgresIngestionRepository({ connectionString: databaseUrl });
    const operatorId = await resolveOperatorId(ingestionRepository, 'scheduled poll run');
    const adapterName = process.env.GENERIC_POLL_ADAPTER_NAME ?? 'generic-poll';
    const intervalMs = readPositiveIntegerEnv('GENERIC_POLL_INTERVAL_MS', 15 * 60 * 1000);
    const retryBaseDelayMs = readPositiveIntegerEnv('GENERIC_POLL_RETRY_BASE_DELAY_MS', 60 * 1000);
    const maxRetryDelayMs = readPositiveIntegerEnv('GENERIC_POLL_MAX_RETRY_DELAY_MS', intervalMs);
    const runImmediately =
      process.env.GENERIC_POLL_RUN_IMMEDIATELY === undefined
        ? !pollRanOnStart
        : process.env.GENERIC_POLL_RUN_IMMEDIATELY === 'true';
    const scheduler = startGenericPollScheduler({
      run: () =>
        runGenericPollOnce({
          ingestionRepository,
          operatorId,
          adapterName
        }),
      intervalMs,
      retryBaseDelayMs,
      maxRetryDelayMs,
      runImmediately
    });

    const stop = () => {
      scheduler.stop();
      void ingestionRepository.close().finally(() => {
        process.exit(0);
      });
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    console.log(
      JSON.stringify(
        {
          event: 'generic_poll_scheduler_started',
          adapter_name: adapterName,
          interval_ms: intervalMs,
          retry_base_delay_ms: retryBaseDelayMs,
          max_retry_delay_ms: maxRetryDelayMs,
          run_immediately: runImmediately
        },
        null,
        2
      )
    );
  }

  if (process.env.RUN_ENGINE_ON_START === 'true') {
    if (!databaseUrl) {
      throw new Error('RUN_ENGINE_ON_START requires DATABASE_URL');
    }

    const ingestionRepository = new PostgresIngestionRepository({ connectionString: databaseUrl });
    const engineRepository = new PostgresJournalEngineRepository({ connectionString: databaseUrl });

    try {
      const operatorId = await resolveOperatorId(ingestionRepository, 'engine run');
      const engine = new JournalEngineService(engineRepository, {
        suspenseAccountCode: process.env.SUSPENSE_ACCOUNT_CODE
      });
      const result = await engine.runOnce({
        operatorId,
        limit: Number(process.env.ENGINE_BATCH_SIZE ?? '500')
      });

      console.log(
        JSON.stringify(
          {
            scanned: result.scanned,
            generated: result.generated,
            skipped: result.skipped.length
          },
          null,
          2
        )
      );
    } finally {
      await engineRepository.close();
      await ingestionRepository.close();
    }
  }
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}
