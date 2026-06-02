import { JournalEngineService } from '@ledgerise/core-engine';
import { PostgresJournalEngineRepository } from '@ledgerise/core-engine/postgres';
import { PostgresIngestionRepository } from '@ledgerise/core-ingestion/postgres';

const schedule = process.env.ENGINE_SCHEDULE_CRON ?? '0 * * * *';
const databaseUrl = process.env.DATABASE_URL;

console.log(`Ledgerise worker ready. Engine schedule: ${schedule}.`);

if (process.env.RUN_ENGINE_ON_START === 'true') {
  if (!databaseUrl) {
    throw new Error('RUN_ENGINE_ON_START requires DATABASE_URL');
  }

  const ingestionRepository = new PostgresIngestionRepository({ connectionString: databaseUrl });
  const operatorId =
    process.env.DEFAULT_OPERATOR_ID ??
    (await ingestionRepository.findOperatorIdBySlug(
      process.env.DEFAULT_OPERATOR_SLUG ?? 'local-operator'
    ));

  if (!operatorId) {
    throw new Error('No operator found for engine run');
  }

  const engineRepository = new PostgresJournalEngineRepository({ connectionString: databaseUrl });
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

  await engineRepository.close();
  await ingestionRepository.close();
}
