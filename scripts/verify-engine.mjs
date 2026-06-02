import { randomUUID } from 'node:crypto';

import { IngestionService } from '@ledgerise/core-ingestion';
import { PostgresIngestionRepository } from '@ledgerise/core-ingestion/postgres';
import { MappingService } from '@ledgerise/core-mapping';
import { PostgresMappingRepository } from '@ledgerise/core-mapping/postgres';
import { JournalEngineService } from '@ledgerise/core-engine';
import { PostgresJournalEngineRepository } from '@ledgerise/core-engine/postgres';
import { settledBillPayment, pendingTransaction, testEnvironmentTransaction } from '@ledgerise/test-fixtures';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/ledgerise';
const codePrefix = `ENGINE-${Date.now()}`;
const productLine = `engine-product-${Date.now()}`;
const suspenseAccountCode = `${codePrefix}-9999`;

const ingestionRepository = new PostgresIngestionRepository({ connectionString: databaseUrl });
const mappingRepository = new PostgresMappingRepository({ connectionString: databaseUrl });
const engineRepository = new PostgresJournalEngineRepository({ connectionString: databaseUrl });
const ingestionService = new IngestionService(ingestionRepository);
const mappingService = new MappingService(mappingRepository);
const engine = new JournalEngineService(engineRepository, { suspenseAccountCode });

try {
  const operatorId =
    process.env.DEFAULT_OPERATOR_ID ??
    (await ingestionRepository.findOperatorIdBySlug(process.env.DEFAULT_OPERATOR_SLUG ?? 'local-operator'));

  if (!operatorId) {
    throw new Error('No default operator found. Run infra/seed/0001_local_operator_and_adapters.sql first.');
  }

  const accounts = [
    { code: `${codePrefix}-1000`, name: 'Engine Verification Cash', type: 'asset' },
    { code: `${codePrefix}-4000`, name: 'Engine Verification Exact Revenue', type: 'revenue' },
    { code: `${codePrefix}-4010`, name: 'Engine Verification Category Revenue', type: 'revenue' },
    { code: `${codePrefix}-4020`, name: 'Engine Verification Catch-all Revenue', type: 'revenue' },
    { code: suspenseAccountCode, name: 'Engine Verification Suspense', type: 'liability' }
  ];
  await mappingService.importChartAccounts(operatorId, accounts);

  const exactRule = await mappingService.createMappingRule(operatorId, {
    productLine,
    biller: 'ikeja-electric',
    transactionType: 'payment.electricity',
    debitAccountCode: accounts[0].code,
    creditSplits: [{ accountCode: accounts[1].code, percentageBps: 10000 }]
  });
  const categoryRule = await mappingService.createMappingRule(operatorId, {
    productLine,
    billerCategory: 'electricity',
    debitAccountCode: accounts[0].code,
    creditSplits: [{ accountCode: accounts[2].code, percentageBps: 10000 }]
  });
  const catchAllRule = await mappingService.createMappingRule(operatorId, {
    productLine,
    debitAccountCode: accounts[0].code,
    creditSplits: [{ accountCode: accounts[3].code, percentageBps: 10000 }]
  });

  const exact = makeTransaction('exact', {
    product: { line: productLine, biller: 'ikeja-electric', biller_category: 'electricity' }
  });
  const category = makeTransaction('category', {
    product: { line: productLine, biller: 'eko-electric', biller_category: 'electricity' }
  });
  const catchAll = makeTransaction('catch-all', {
    product: { line: productLine, biller: 'dstv', biller_category: 'cable-tv' },
    type: 'payment.cable-tv'
  });
  const unmapped = makeTransaction('unmapped', {
    product: { line: `${productLine}-unmapped`, biller: 'unknown', biller_category: 'unknown' },
    type: 'payment.toll'
  });
  const original = makeTransaction('reversal-original', {
    product: { line: productLine, biller: 'ikeja-electric', biller_category: 'electricity' }
  });
  const reversal = makeTransaction('reversal', {
    status: 'reversed',
    type: 'system.reversal',
    direction: 'credit',
    reversal_of: original.id,
    product: { line: productLine, biller: 'ikeja-electric', biller_category: 'electricity' }
  });
  const pending = makeTransaction('pending', {
    ...pendingTransaction,
    product: { line: productLine, biller: 'ikeja-electric', biller_category: 'electricity' }
  });
  const test = makeTransaction('test', {
    ...testEnvironmentTransaction,
    product: { line: productLine, biller: 'ikeja-electric', biller_category: 'electricity' }
  });

  for (const record of [exact, category, catchAll, unmapped, original, reversal, pending, test]) {
    const result = await ingestionService.ingestCanonicalTransaction({
      operatorId,
      adapterName: 'generic-webhook',
      record
    });
    assert(result.status === 'accepted', `transaction ${record.id} accepted`);
  }

  const firstRun = await engine.runOnce({ operatorId, limit: 50 });
  assert(firstRun.generated >= 6, 'first engine run generated at least the verification entries');

  const exactEntry = requireEntry(firstRun, exact.id);
  assertEqual(exactEntry.mappingRuleId, exactRule.id, 'exact rule selected');
  assertLine(exactEntry, 'debit', accounts[0].code, exact.amount);
  assertLine(exactEntry, 'credit', accounts[1].code, exact.amount);

  const categoryEntry = requireEntry(firstRun, category.id);
  assertEqual(categoryEntry.mappingRuleId, categoryRule.id, 'category fallback selected');
  assertLine(categoryEntry, 'credit', accounts[2].code, category.amount);

  const catchAllEntry = requireEntry(firstRun, catchAll.id);
  assertEqual(catchAllEntry.mappingRuleId, catchAllRule.id, 'product-line catch-all selected');
  assertLine(catchAllEntry, 'credit', accounts[3].code, catchAll.amount);

  const unmappedEntry = requireEntry(firstRun, unmapped.id);
  assertEqual(unmappedEntry.status, 'unmapped', 'unmapped entry status');
  assertLine(unmappedEntry, 'debit', suspenseAccountCode, unmapped.amount);
  assertLine(unmappedEntry, 'credit', suspenseAccountCode, unmapped.amount);

  const originalEntry = requireEntry(firstRun, original.id);
  const reversalEntry = requireEntry(firstRun, reversal.id);
  assertEqual(reversalEntry.entryType, 'reversal', 'reversal entry type');
  assertEqual(
    reversalEntry.reversalOfJournalEntryId,
    originalEntry.id,
    'reversal references original journal'
  );
  assertLine(reversalEntry, 'credit', accounts[0].code, original.amount);
  assertLine(reversalEntry, 'debit', accounts[1].code, original.amount);

  assert(
    !(await engineRepository.findJournalEntryByTransactionId({ operatorId, transactionId: pending.id })),
    'pending transaction was not journaled'
  );
  assert(
    !(await engineRepository.findJournalEntryByTransactionId({ operatorId, transactionId: test.id })),
    'test transaction was not journaled'
  );

  const secondRun = await engine.runOnce({ operatorId, limit: 50 });
  assertEqual(secondRun.generated, 0, 'second engine run generated count');

  console.log('Journal engine verification passed.');
  console.log(
    JSON.stringify(
      {
        generated: firstRun.generated,
        idempotent_second_run: secondRun.generated,
        exact_rule_id: exactRule.id,
        category_rule_id: categoryRule.id,
        catch_all_rule_id: catchAllRule.id,
        suspense_account_code: suspenseAccountCode
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('Journal engine verification failed.');
  console.error(error instanceof Error ? error.stack : JSON.stringify(error));
  process.exitCode = 1;
} finally {
  await engineRepository.close();
  await mappingRepository.close?.();
  await ingestionRepository.close();
}

function makeTransaction(label, patch) {
  const base = 'id' in patch ? patch : settledBillPayment;
  return {
    ...base,
    ...patch,
    id: randomUUID(),
    source_id: `${codePrefix}-${label}`,
    source: {
      ...base.source,
      ...(patch.source ?? {}),
      adapter: 'generic-webhook'
    },
    product: {
      ...base.product,
      ...(patch.product ?? {})
    },
    metadata: {
      ...base.metadata,
      verification_label: label
    }
  };
}

function requireEntry(run, transactionId) {
  const entry = run.entries.find((item) => item.transactionId === transactionId);
  if (!entry) throw new Error(`Missing journal entry for transaction ${transactionId}`);
  assertBalanced(entry);
  return entry;
}

function assertLine(entry, side, accountCode, amount) {
  assert(
    entry.lines.some(
      (line) => line.side === side && line.accountCode === accountCode && line.amount === amount
    ),
    `entry ${entry.id} includes ${side} ${accountCode} ${amount}`
  );
}

function assertBalanced(entry) {
  const debit = entry.lines
    .filter((line) => line.side === 'debit')
    .reduce((sum, line) => sum + line.amount, 0);
  const credit = entry.lines
    .filter((line) => line.side === 'credit')
    .reduce((sum, line) => sum + line.amount, 0);
  assertEqual(debit, credit, `entry ${entry.id} balances`);
}

function assert(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${label}. Expected ${expected}, got ${actual}`);
  }
}
