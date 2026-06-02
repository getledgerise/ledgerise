import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  postJournals as postGenericJournalCsv,
  validate as validateGenericJournalCsv
} from '@ledgerise/adapter-outbound-generic-journal-csv';
import {
  IngestionService,
  InMemoryIngestionRepository,
  type IngestionErrorListInput,
  type IngestionRepository,
  type StoredCanonicalTransaction,
  type StoredIngestionError,
  type TransactionListInput
} from '@ledgerise/core-ingestion';
import { PostgresIngestionRepository } from '@ledgerise/core-ingestion/postgres';
import {
  InMemoryMappingRepository,
  MappingService,
  MappingValidationError,
  type MappingRepository,
  type NewMappingRule,
  type UpdateMappingRule
} from '@ledgerise/core-mapping';
import { PostgresMappingRepository } from '@ledgerise/core-mapping/postgres';
import {
  InMemoryPostingRepository,
  PostingService,
  PostingStateError,
  type JournalLogEntry,
  type PostingBatch,
  type PostingRepository
} from '@ledgerise/core-posting';
import { PostgresPostingRepository } from '@ledgerise/core-posting/postgres';

import { findAdapter, listAdapters } from './adapterRegistry.js';

const port = Number(process.env.API_PORT ?? '3000');

const { ingestionRepository, mappingRepository, postingRepository, defaultOperatorId, repositoryKind } =
  await createRepositories();
const ingestionService = new IngestionService(ingestionRepository);
const mappingService = new MappingService(mappingRepository);
const postingService = new PostingService(postingRepository);

const server = createServer(async (request, response) => {
  applyCors(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/healthcheck') {
    sendJson(response, 200, {
      status: 'ok',
      service: 'ledgerise-api',
      repository: repositoryKind
    });
    return;
  }

  const ingestMatch = /^\/api\/ingest\/([^/]+)$/.exec(url.pathname);

  if (request.method === 'POST' && ingestMatch) {
    const adapterName = decodeURIComponent(ingestMatch[1] ?? '');
    const adapter = findAdapter(adapterName);

    if (!adapter) {
      sendJson(response, 404, {
        status: 'error',
        code: 'ADAPTER_NOT_FOUND',
        message: `Adapter "${adapterName}" is not registered`
      });
      return;
    }

    if (adapter.direction !== 'inbound') {
      sendJson(response, 400, {
        status: 'error',
        code: 'ADAPTER_NOT_INBOUND',
        message: `Adapter "${adapterName}" cannot ingest canonical transactions`
      });
      return;
    }

    const body = await readJsonBody(request);

    if (!body.ok) {
      sendJson(response, 400, {
        status: 'error',
        code: 'MALFORMED_JSON',
        message: body.message
      });
      return;
    }

    const result = await ingestionService.ingestCanonicalTransaction({
      operatorId: getHeader(request.headers['x-operator-id']) ?? defaultOperatorId,
      adapterName,
      record: body.value
    });

    if (result.status === 'accepted') {
      sendJson(response, 202, {
        status: 'accepted',
        transaction_id: result.transaction.id,
        dedupe_confidence: result.transaction.dedupeConfidence
      });
      return;
    }

    if (result.status === 'duplicate') {
      sendJson(response, 202, {
        status: 'duplicate',
        transaction_id: result.existingTransaction.id,
        marker_id: result.marker.id
      });
      return;
    }

    sendJson(response, 422, {
      status: 'rejected',
      error_id: result.error.id,
      error_type: result.error.errorType,
      errors: result.error.validationErrors
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/adapters') {
    sendJson(response, 200, {
      records: listAdapters()
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/transactions') {
    const operatorId = getOperatorId(request);
    const filters = parseTransactionListQuery(url, operatorId);

    if (!filters.ok) {
      sendJson(response, 400, filters.error);
      return;
    }

    const transactions = await ingestionRepository.listTransactions(filters.value);

    sendJson(response, 200, {
      records: transactions.records.map(toTransactionSummary),
      page: transactions.page
    });
    return;
  }

  const transactionMatch = /^\/api\/transactions\/([^/]+)$/.exec(url.pathname);

  if (request.method === 'GET' && transactionMatch) {
    const operatorId = getOperatorId(request);
    const transactionId = decodeURIComponent(transactionMatch[1] ?? '');
    const transaction = await ingestionRepository.findTransactionById({ operatorId, transactionId });

    if (!transaction) {
      sendJson(response, 404, {
        status: 'error',
        code: 'TRANSACTION_NOT_FOUND',
        message: `Transaction "${transactionId}" was not found`
      });
      return;
    }

    sendJson(response, 200, {
      record: toTransactionDetail(transaction)
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/ingestion-errors') {
    const operatorId = getOperatorId(request);
    const filters = parseIngestionErrorListQuery(url, operatorId);

    if (!filters.ok) {
      sendJson(response, 400, filters.error);
      return;
    }

    const ingestionErrors = await ingestionRepository.listIngestionErrors(filters.value);

    sendJson(response, 200, {
      records: ingestionErrors.records.map(toIngestionErrorResponse),
      page: ingestionErrors.page
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/journal-entries') {
    const operatorId = getOperatorId(request);
    const filters = parseJournalEntryListQuery(url, operatorId);

    if (!filters.ok) {
      sendJson(response, 400, filters.error);
      return;
    }

    const journalEntries = await postingService.listJournalEntries(filters.value);
    sendJson(response, 200, {
      records: journalEntries.records.map(toJournalEntryResponse),
      page: journalEntries.page
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/posting-batches/generic-journal-csv') {
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendJson(response, 400, { status: 'error', code: 'MALFORMED_JSON', message: body.message });
      return;
    }

    const payload = isRecord(body.value) ? body.value : {};
    const rawLimit = readNumber(payload, 'limit');
    const limit = rawLimit === undefined ? 100 : rawLimit;

    try {
      const batch = await postingService.createPostingBatch({
        operatorId: getOperatorId(request),
        adapterName: 'generic-journal-csv',
        journalEntryIds: readStringArray(payload, 'journal_entry_ids') ?? readStringArray(payload, 'journalEntryIds'),
        limit
      });
      const outboundBatch = toOutboundJournalBatch(batch);
      const validation = validateGenericJournalCsv(outboundBatch);

      if (!validation.valid) {
        const completed = await postingService.completePostingBatch({
          operatorId: getOperatorId(request),
          batchId: batch.id,
          adapterName: 'generic-journal-csv',
          results: batch.entries.map((entry) => ({
            journalEntryId: entry.id,
            status: 'failed',
            errorCode: 'VALIDATION_FAILED',
            errorMessage: validation.errors.map((error) => `${error.field}: ${error.message}`).join('; ')
          }))
        });
        sendJson(response, 422, {
          status: 'error',
          code: 'VALIDATION_FAILED',
          batch: completed ? toPostingBatchResponse(completed) : undefined,
          errors: validation.errors
        });
        return;
      }

      const adapterResult = await postGenericJournalCsv(outboundBatch);
      const completed = await postingService.completePostingBatch({
        operatorId: getOperatorId(request),
        batchId: batch.id,
        adapterName: 'generic-journal-csv',
        results: [
          ...adapterResult.posted.map((result) => ({
            journalEntryId: result.journal_entry_id,
            status: 'posted' as const,
            externalReference: result.external_reference
          })),
          ...adapterResult.failed.map((result) => ({
            journalEntryId: result.journal_entry_id,
            status: 'failed' as const,
            errorCode: result.code,
            errorMessage: result.message
          }))
        ]
      });

      sendJson(response, adapterResult.status === 'ok' ? 201 : 207, {
        status: adapterResult.status,
        batch: completed ? toPostingBatchResponse(completed) : undefined,
        posted: adapterResult.posted,
        failed: adapterResult.failed,
        artifact: adapterResult.artifact
      });
    } catch (error) {
      if (error instanceof PostingStateError) {
        sendJson(response, error.code === 'NO_POSTABLE_JOURNALS' ? 409 : 400, {
          status: 'error',
          code: error.code,
          message: error.message
        });
        return;
      }
      throw error;
    }
    return;
  }

  const journalEntryMatch = /^\/api\/journal-entries\/([^/]+)$/.exec(url.pathname);

  if (request.method === 'GET' && journalEntryMatch) {
    const journalEntryId = decodeURIComponent(journalEntryMatch[1] ?? '');
    const journalEntry = await postingService.findJournalEntry({
      operatorId: getOperatorId(request),
      journalEntryId
    });

    if (!journalEntry) {
      sendJson(response, 404, {
        status: 'error',
        code: 'JOURNAL_ENTRY_NOT_FOUND',
        message: `Journal entry "${journalEntryId}" was not found`
      });
      return;
    }

    sendJson(response, 200, { record: toJournalEntryResponse(journalEntry) });
    return;
  }

  const journalEntryRetryMatch = /^\/api\/journal-entries\/([^/]+)\/retry$/.exec(url.pathname);

  if (request.method === 'POST' && journalEntryRetryMatch) {
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendJson(response, 400, { status: 'error', code: 'MALFORMED_JSON', message: body.message });
      return;
    }

    const journalEntryId = decodeURIComponent(journalEntryRetryMatch[1] ?? '');
    const retryInput = isRecord(body.value) ? body.value : {};

    try {
      const journalEntry = await postingService.requestManualRetry({
        operatorId: getOperatorId(request),
        journalEntryId,
        adapterName: readString(retryInput, 'adapter_name') ?? 'generic-journal-csv',
        requestedByUserId: getHeader(request.headers['x-user-id'])
      });

      if (!journalEntry) {
        sendJson(response, 404, {
          status: 'error',
          code: 'JOURNAL_ENTRY_NOT_FOUND',
          message: `Journal entry "${journalEntryId}" was not found`
        });
        return;
      }

      sendJson(response, 200, { record: toJournalEntryResponse(journalEntry) });
    } catch (error) {
      if (error instanceof PostingStateError) {
        sendJson(response, 409, {
          status: 'error',
          code: error.code,
          message: error.message
        });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/coa') {
    sendJson(response, 200, {
      records: await mappingService.listChartAccounts(getOperatorId(request))
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/coa/import') {
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendJson(response, 400, { status: 'error', code: 'MALFORMED_JSON', message: body.message });
      return;
    }
    const accounts = isRecord(body.value) ? body.value.accounts : undefined;
    if (!Array.isArray(accounts)) {
      sendJson(response, 400, {
        status: 'error',
        code: 'INVALID_BODY',
        message: 'Body must include accounts array'
      });
      return;
    }
    const result = await handleMappingRequest(response, () =>
      mappingService.importChartAccounts(getOperatorId(request), accounts)
    );
    if (result) sendJson(response, 200, { records: result });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/mapping-rules') {
    sendJson(response, 200, {
      records: await mappingService.listMappingRules(getOperatorId(request))
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/mapping-rules') {
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendJson(response, 400, { status: 'error', code: 'MALFORMED_JSON', message: body.message });
      return;
    }
    const result = await handleMappingRequest(response, () =>
      mappingService.createMappingRule(getOperatorId(request), toMappingRuleInput(body.value))
    );
    if (result) sendJson(response, 201, { record: result });
    return;
  }

  const mappingRuleMatch = /^\/api\/mapping-rules\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'PATCH' && mappingRuleMatch) {
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendJson(response, 400, { status: 'error', code: 'MALFORMED_JSON', message: body.message });
      return;
    }
    const ruleId = decodeURIComponent(mappingRuleMatch[1] ?? '');
    const result = await handleMappingRequest(response, () =>
      mappingService.updateMappingRule(getOperatorId(request), ruleId, toMappingRuleUpdateInput(body.value))
    );
    if (result === null) {
      sendJson(response, 404, { status: 'error', code: 'MAPPING_RULE_NOT_FOUND', message: 'Mapping rule not found' });
    } else if (result) {
      sendJson(response, 200, { record: result });
    }
    return;
  }

  const mappingRuleStatusMatch = /^\/api\/mapping-rules\/([^/]+)\/(activate|deactivate)$/.exec(
    url.pathname
  );
  if (request.method === 'POST' && mappingRuleStatusMatch) {
    const ruleId = decodeURIComponent(mappingRuleStatusMatch[1] ?? '');
    const status = mappingRuleStatusMatch[2] === 'activate' ? 'active' : 'inactive';
    const result = await mappingService.setMappingRuleStatus(getOperatorId(request), ruleId, status);
    if (!result) {
      sendJson(response, 404, { status: 'error', code: 'MAPPING_RULE_NOT_FOUND', message: 'Mapping rule not found' });
      return;
    }
    sendJson(response, 200, { record: result });
    return;
  }

  sendJson(response, 404, {
    status: 'error',
    code: 'NOT_FOUND',
    message: 'Route not found'
  });
});

server.listen(port, () => {
  console.log(`Ledgerise API listening on port ${port} using ${repositoryKind} ingestion storage.`);
});

async function createRepositories(): Promise<{
  ingestionRepository: IngestionRepository;
  mappingRepository: MappingRepository;
  postingRepository: PostingRepository;
  defaultOperatorId: string;
  repositoryKind: 'memory' | 'postgres';
}> {
  if (!process.env.DATABASE_URL) {
    return {
      ingestionRepository: new InMemoryIngestionRepository(),
      mappingRepository: new InMemoryMappingRepository(),
      postingRepository: new InMemoryPostingRepository(),
      defaultOperatorId: process.env.DEFAULT_OPERATOR_ID ?? 'local-operator',
      repositoryKind: 'memory'
    };
  }

  const ingestionRepository = new PostgresIngestionRepository({
    connectionString: process.env.DATABASE_URL
  });
  const mappingRepository = new PostgresMappingRepository({
    connectionString: process.env.DATABASE_URL
  });
  const postingRepository = new PostgresPostingRepository({
    connectionString: process.env.DATABASE_URL
  });
  const defaultOperatorId =
    process.env.DEFAULT_OPERATOR_ID ??
    (await ingestionRepository.findOperatorIdBySlug(process.env.DEFAULT_OPERATOR_SLUG ?? 'local-operator'));

  if (!defaultOperatorId) {
    throw new Error(
      'No default operator found. Set DEFAULT_OPERATOR_ID or run infra/seed/0001_local_operator_and_adapters.sql.'
    );
  }

  return {
    ingestionRepository,
    mappingRepository,
    postingRepository,
    defaultOperatorId,
    repositoryKind: 'postgres'
  };
}

async function readJsonBody(
  request: IncomingMessage
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  try {
    return {
      ok: true,
      value: JSON.parse(Buffer.concat(chunks).toString('utf8'))
    };
  } catch {
    return {
      ok: false,
      message: 'Request body must be valid JSON'
    };
  }
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown
) {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*'
  });
  response.end(JSON.stringify(body));
}

function applyCors(response: ServerResponse) {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type,x-operator-id,x-user-id');
}

function getHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getOperatorId(request: IncomingMessage): string {
  return getHeader(request.headers['x-operator-id']) ?? defaultOperatorId;
}

function toTransactionSummary(transaction: StoredCanonicalTransaction) {
  return {
    id: transaction.id,
    source_id: transaction.record.source_id,
    source: transaction.record.source,
    occurred_at: transaction.record.occurred_at,
    settled_at: transaction.record.settled_at,
    status: transaction.record.status,
    posting_status: transaction.postingStatus,
    type: transaction.record.type,
    direction: transaction.record.direction,
    amount: transaction.record.amount,
    currency: transaction.record.currency,
    product: transaction.record.product,
    channel: transaction.record.channel,
    dedupe_confidence: transaction.dedupeConfidence,
    ingested_at: transaction.ingestedAt
  };
}

function toTransactionDetail(transaction: StoredCanonicalTransaction) {
  return {
    ...toTransactionSummary(transaction),
    canonical_record: transaction.record
  };
}

function toIngestionErrorResponse(error: StoredIngestionError) {
  return {
    id: error.id,
    adapter_name: error.adapterName,
    error_type: error.errorType,
    source_system: error.sourceSystem,
    source_id: error.sourceId,
    existing_transaction_id: error.existingTransactionId,
    validation_errors: error.validationErrors,
    raw_record: error.rawRecord,
    occurred_at: error.occurredAt
  };
}

function toJournalEntryResponse(entry: JournalLogEntry) {
  return {
    id: entry.id,
    transaction_id: entry.transactionId,
    entry_type: entry.entryType,
    status: entry.status,
    posting_status: entry.postingStatus,
    currency: entry.currency,
    amount: entry.amount,
    mapping_rule_id: entry.mappingRuleId,
    mapping_rule_version: entry.mappingRuleVersion,
    reversal_of_journal_entry_id: entry.reversalOfJournalEntryId,
    generated_at: entry.generatedAt,
    posted_at: entry.postedAt,
    last_posting_attempt_at: entry.lastPostingAttemptAt,
    last_posting_error: entry.lastPostingError,
    attempt_count: entry.attemptCount,
    lines: entry.lines.map((line) => ({
      account_code: line.accountCode,
      side: line.side,
      amount: line.amount,
      currency: line.currency,
      line_order: line.lineOrder
    })),
    transaction: entry.transaction
      ? {
          id: entry.transaction.id,
          source_id: entry.transaction.sourceId,
          status: entry.transaction.status,
          type: entry.transaction.type,
          occurred_at: entry.transaction.occurredAt,
          settled_at: entry.transaction.settledAt,
          source_adapter: entry.transaction.sourceAdapter,
          source_system: entry.transaction.sourceSystem,
          product_line: entry.transaction.productLine,
          product_biller: entry.transaction.productBiller,
          product_biller_category: entry.transaction.productBillerCategory
        }
      : undefined,
    attempts: entry.attempts.map((attempt) => ({
      id: attempt.id,
      adapter_name: attempt.adapterName,
      status: attempt.status,
      attempt_number: attempt.attemptNumber,
      external_reference: attempt.externalReference,
      error_code: attempt.errorCode,
      error_message: attempt.errorMessage,
      requested_by_user_id: attempt.requestedByUserId,
      occurred_at: attempt.occurredAt
    })),
    latest_attempt: entry.latestAttempt
      ? {
          id: entry.latestAttempt.id,
          adapter_name: entry.latestAttempt.adapterName,
          status: entry.latestAttempt.status,
          attempt_number: entry.latestAttempt.attemptNumber,
          external_reference: entry.latestAttempt.externalReference,
          error_code: entry.latestAttempt.errorCode,
          error_message: entry.latestAttempt.errorMessage,
          requested_by_user_id: entry.latestAttempt.requestedByUserId,
          occurred_at: entry.latestAttempt.occurredAt
        }
      : undefined
  };
}

function toPostingBatchResponse(batch: PostingBatch) {
  return {
    id: batch.id,
    adapter_name: batch.adapterName,
    status: batch.status,
    journal_entry_count: batch.journalEntryCount,
    created_at: batch.createdAt,
    updated_at: batch.updatedAt,
    entries: batch.entries.map(toJournalEntryResponse)
  };
}

function toOutboundJournalBatch(batch: PostingBatch) {
  return {
    id: batch.id,
    operator_id: batch.operatorId,
    adapter_name: batch.adapterName,
    created_at: batch.createdAt,
    entries: batch.entries.map((entry) => ({
      id: entry.id,
      transaction_id: entry.transactionId,
      source_id: entry.transaction?.sourceId,
      transaction_type: entry.transaction?.type,
      product_line: entry.transaction?.productLine,
      product_biller: entry.transaction?.productBiller,
      entry_type: entry.entryType,
      currency: entry.currency,
      amount: entry.amount,
      generated_at: entry.generatedAt,
      mapping_rule_id: entry.mappingRuleId,
      mapping_rule_version: entry.mappingRuleVersion,
      lines: entry.lines.map((line) => ({
        account_code: line.accountCode,
        side: line.side,
        amount: line.amount,
        currency: line.currency,
        line_order: line.lineOrder
      }))
    }))
  };
}

type ParsedQuery<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: {
        status: 'error';
        code: string;
        message: string;
      };
    };

const transactionStatuses = new Set(['pending', 'settled', 'failed', 'reversed', 'disputed']);
const postingStatuses = new Set(['unposted']);
const journalPostingStatuses = new Set([
  'generated',
  'posting',
  'posted',
  'failed',
  'unmapped',
  'retry_exhausted'
]);
const environments = new Set(['live', 'test']);
const ingestionErrorTypes = new Set([
  'schema_validation',
  'adapter_mismatch',
  'duplicate_source'
]);

function parseTransactionListQuery(
  url: URL,
  operatorId: string
): ParsedQuery<TransactionListInput> {
  const pagination = parsePagination(url);

  if (!pagination.ok) {
    return pagination;
  }

  const status = getQueryParam(url, 'status');
  const postingStatus = getQueryParam(url, 'posting_status');
  const environment = getQueryParam(url, 'environment');
  const occurredFrom = getQueryParam(url, 'occurred_from');
  const occurredTo = getQueryParam(url, 'occurred_to');
  const dateValidation = validateDateRange(occurredFrom, occurredTo);

  if (status && !transactionStatuses.has(status)) {
    return invalidQuery(`Unsupported transaction status "${status}"`);
  }

  if (postingStatus && !postingStatuses.has(postingStatus)) {
    return invalidQuery(`Unsupported posting status "${postingStatus}"`);
  }

  if (environment && !environments.has(environment)) {
    return invalidQuery(`Unsupported environment "${environment}"`);
  }

  if (!dateValidation.ok) {
    return dateValidation;
  }

  return {
    ok: true,
    value: {
      operatorId,
      ...pagination.value,
      status: status as TransactionListInput['status'],
      postingStatus: postingStatus as TransactionListInput['postingStatus'],
      productLine: getQueryParam(url, 'product_line'),
      biller: getQueryParam(url, 'biller'),
      adapter: getQueryParam(url, 'adapter'),
      environment: environment as TransactionListInput['environment'],
      occurredFrom,
      occurredTo
    }
  };
}

function parseIngestionErrorListQuery(
  url: URL,
  operatorId: string
): ParsedQuery<IngestionErrorListInput> {
  const pagination = parsePagination(url);

  if (!pagination.ok) {
    return pagination;
  }

  const errorType = getQueryParam(url, 'error_type');
  const occurredFrom = getQueryParam(url, 'occurred_from');
  const occurredTo = getQueryParam(url, 'occurred_to');
  const dateValidation = validateDateRange(occurredFrom, occurredTo);

  if (errorType && !ingestionErrorTypes.has(errorType)) {
    return invalidQuery(`Unsupported ingestion error type "${errorType}"`);
  }

  if (!dateValidation.ok) {
    return dateValidation;
  }

  return {
    ok: true,
    value: {
      operatorId,
      ...pagination.value,
      adapterName: getQueryParam(url, 'adapter'),
      errorType: errorType as IngestionErrorListInput['errorType'],
      sourceSystem: getQueryParam(url, 'source_system'),
      sourceId: getQueryParam(url, 'source_id'),
      occurredFrom,
      occurredTo
    }
  };
}

function parseJournalEntryListQuery(
  url: URL,
  operatorId: string
): ParsedQuery<{
  operatorId: string;
  limit: number;
  offset: number;
  postingStatus?: JournalLogEntry['postingStatus'];
}> {
  const pagination = parsePagination(url);

  if (!pagination.ok) {
    return pagination;
  }

  const postingStatus = getQueryParam(url, 'posting_status');
  if (postingStatus && !journalPostingStatuses.has(postingStatus)) {
    return invalidQuery(`Unsupported journal posting status "${postingStatus}"`);
  }

  return {
    ok: true,
    value: {
      operatorId,
      ...pagination.value,
      postingStatus: postingStatus as JournalLogEntry['postingStatus']
    }
  };
}

function parsePagination(url: URL): ParsedQuery<{ limit: number; offset: number }> {
  const limit = getIntegerQueryParam(url, 'limit', 100);
  const offset = getIntegerQueryParam(url, 'offset', 0);

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return invalidQuery('Query parameter "limit" must be an integer from 1 to 500');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    return invalidQuery('Query parameter "offset" must be an integer greater than or equal to 0');
  }

  return {
    ok: true,
    value: {
      limit,
      offset
    }
  };
}

function validateDateRange(
  occurredFrom: string | undefined,
  occurredTo: string | undefined
): ParsedQuery<undefined> {
  if (occurredFrom && Number.isNaN(Date.parse(occurredFrom))) {
    return invalidQuery('Query parameter "occurred_from" must be an ISO 8601 timestamp');
  }

  if (occurredTo && Number.isNaN(Date.parse(occurredTo))) {
    return invalidQuery('Query parameter "occurred_to" must be an ISO 8601 timestamp');
  }

  if (occurredFrom && occurredTo && occurredFrom > occurredTo) {
    return invalidQuery('"occurred_from" must be before or equal to "occurred_to"');
  }

  return {
    ok: true,
    value: undefined
  };
}

function getIntegerQueryParam(url: URL, name: string, fallback: number): number {
  const value = getQueryParam(url, name);
  return value ? Number(value) : fallback;
}

function getQueryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value?.trim() || undefined;
}

function invalidQuery(message: string): ParsedQuery<never> {
  return {
    ok: false,
    error: {
      status: 'error',
      code: 'INVALID_QUERY',
      message
    }
  };
}

async function handleMappingRequest<T>(
  response: ServerResponse,
  operation: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MappingValidationError) {
      sendJson(response, 400, {
        status: 'error',
        code: 'VALIDATION_FAILED',
        errors: error.errors
      });
      return undefined;
    }

    throw error;
  }
}

function toMappingRuleInput(input: unknown): NewMappingRule {
  if (!isRecord(input)) {
    throw new MappingValidationError(['Body must be an object']);
  }

  return {
    productLine: readString(input, 'product_line') ?? readString(input, 'productLine') ?? '',
    biller: readString(input, 'biller'),
    billerCategory: readString(input, 'biller_category') ?? readString(input, 'billerCategory'),
    transactionType: readString(input, 'transaction_type') ?? readString(input, 'transactionType'),
    debitAccountCode:
      readString(input, 'debit_account_code') ?? readString(input, 'debitAccountCode') ?? '',
    status: readString(input, 'status') === 'inactive' ? 'inactive' : 'active',
    creditSplits: readCreditSplits(input)
  };
}

function toMappingRuleUpdateInput(input: unknown): UpdateMappingRule {
  if (!isRecord(input)) {
    throw new MappingValidationError(['Body must be an object']);
  }

  return {
    productLine: readString(input, 'product_line') ?? readString(input, 'productLine'),
    biller: readNullableString(input, 'biller'),
    billerCategory:
      readNullableString(input, 'biller_category') ?? readNullableString(input, 'billerCategory'),
    transactionType:
      readNullableString(input, 'transaction_type') ?? readNullableString(input, 'transactionType'),
    debitAccountCode:
      readString(input, 'debit_account_code') ?? readString(input, 'debitAccountCode'),
    creditSplits: Array.isArray(input.credit_splits) || Array.isArray(input.creditSplits)
      ? readCreditSplits(input)
      : undefined
  };
}

function readCreditSplits(input: Record<string, unknown>): NewMappingRule['creditSplits'] {
  const raw = input.credit_splits ?? input.creditSplits;
  if (!Array.isArray(raw)) return [];

  return raw.map((split) => {
    if (!isRecord(split)) {
      return { accountCode: '', percentageBps: 0 };
    }
    return {
      accountCode: readString(split, 'account_code') ?? readString(split, 'accountCode') ?? '',
      percentageBps:
        readNumber(split, 'percentage_bps') ?? readNumber(split, 'percentageBps') ?? 0
    };
  });
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNullableString(input: Record<string, unknown>, key: string): string | null | undefined {
  if (input[key] === null) return null;
  return readString(input, key);
}

function readNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' ? value : undefined;
}

function readStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}
