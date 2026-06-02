import { randomUUID } from 'node:crypto';

export type PostingStatus =
  | 'generated'
  | 'posting'
  | 'posted'
  | 'failed'
  | 'unmapped'
  | 'retry_exhausted';

export type PostingAttemptStatus =
  | 'queued'
  | 'posting'
  | 'posted'
  | 'failed'
  | 'retry_requested';

export interface JournalLogLine {
  accountCode: string;
  side: 'debit' | 'credit';
  amount: number;
  currency: string;
  lineOrder: number;
}

export interface JournalLogEntry {
  id: string;
  operatorId: string;
  transactionId: string;
  entryType: 'standard' | 'reversal' | 'unmapped';
  status: 'generated' | 'unmapped';
  postingStatus: PostingStatus;
  currency: string;
  amount: number;
  mappingRuleId?: string;
  mappingRuleVersion?: number;
  reversalOfJournalEntryId?: string;
  generatedAt: string;
  postedAt?: string;
  lastPostingAttemptAt?: string;
  lastPostingError?: string;
  attemptCount: number;
  lines: JournalLogLine[];
  transaction?: JournalLogTransaction;
  attempts: PostingAttempt[];
  latestAttempt?: PostingAttempt;
}

export interface JournalLogTransaction {
  id: string;
  sourceId?: string;
  status: string;
  type: string;
  occurredAt: string;
  settledAt?: string | null;
  sourceAdapter: string;
  sourceSystem: string;
  productLine: string;
  productBiller?: string;
  productBillerCategory?: string;
}

export interface PostingAttempt {
  id: string;
  operatorId: string;
  journalEntryId: string;
  postingBatchId?: string;
  adapterName: string;
  status: PostingAttemptStatus;
  attemptNumber: number;
  externalReference?: string;
  errorCode?: string;
  errorMessage?: string;
  requestedByUserId?: string;
  occurredAt: string;
}

export type PostingBatchStatus = 'queued' | 'posting' | 'posted' | 'failed' | 'retry_exhausted';

export interface PostingBatch {
  id: string;
  operatorId: string;
  adapterName: string;
  status: PostingBatchStatus;
  journalEntryCount: number;
  createdAt: string;
  updatedAt: string;
  entries: JournalLogEntry[];
}

export interface CreatePostingBatchInput {
  operatorId: string;
  adapterName: string;
  journalEntryIds?: string[];
  limit?: number;
  occurredAt?: string;
}

export interface CompletePostingBatchResult {
  journalEntryId: string;
  status: 'posted' | 'failed';
  externalReference?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface CompletePostingBatchInput {
  operatorId: string;
  batchId: string;
  adapterName: string;
  results: CompletePostingBatchResult[];
  occurredAt?: string;
}

export interface ListJournalEntriesInput {
  operatorId: string;
  limit?: number;
  offset?: number;
  postingStatus?: PostingStatus;
}

export interface ListPage<T> {
  records: T[];
  page: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface ManualRetryInput {
  operatorId: string;
  journalEntryId: string;
  adapterName: string;
  requestedByUserId?: string;
  occurredAt?: string;
}

export interface PostingRepository {
  listJournalEntries(input: ListJournalEntriesInput & {
    limit: number;
    offset: number;
  }): Promise<ListPage<JournalLogEntry>>;
  findJournalEntry(input: {
    operatorId: string;
    journalEntryId: string;
  }): Promise<JournalLogEntry | null>;
  requestManualRetry(input: ManualRetryInput & {
    occurredAt: string;
  }): Promise<JournalLogEntry | null>;
  createPostingBatch(input: CreatePostingBatchInput & {
    limit: number;
    occurredAt: string;
  }): Promise<PostingBatch>;
  completePostingBatch(input: CompletePostingBatchInput & {
    occurredAt: string;
  }): Promise<PostingBatch | null>;
}

export class PostingStateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PostingStateError';
    this.code = code;
  }
}

export class PostingService {
  private readonly now: () => string;

  constructor(private readonly repository: PostingRepository, options: { now?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  listJournalEntries(input: ListJournalEntriesInput): Promise<ListPage<JournalLogEntry>> {
    return this.repository.listJournalEntries({
      operatorId: input.operatorId,
      limit: input.limit ?? 100,
      offset: input.offset ?? 0,
      postingStatus: input.postingStatus
    });
  }

  findJournalEntry(input: {
    operatorId: string;
    journalEntryId: string;
  }): Promise<JournalLogEntry | null> {
    return this.repository.findJournalEntry(input);
  }

  async requestManualRetry(input: ManualRetryInput): Promise<JournalLogEntry | null> {
    const entry = await this.repository.findJournalEntry({
      operatorId: input.operatorId,
      journalEntryId: input.journalEntryId
    });

    if (!entry) return null;
    if (!['failed', 'retry_exhausted'].includes(entry.postingStatus)) {
      throw new PostingStateError(
        'ENTRY_NOT_RETRYABLE',
        `Journal entry ${input.journalEntryId} is ${entry.postingStatus}, not retryable`
      );
    }

    return this.repository.requestManualRetry({
      operatorId: input.operatorId,
      journalEntryId: input.journalEntryId,
      adapterName: input.adapterName,
      requestedByUserId: input.requestedByUserId,
      occurredAt: input.occurredAt ?? this.now()
    });
  }

  async createPostingBatch(input: CreatePostingBatchInput): Promise<PostingBatch> {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new PostingStateError(
        'INVALID_BATCH_LIMIT',
        'Posting batch limit must be an integer from 1 to 500'
      );
    }

    const batch = await this.repository.createPostingBatch({
      operatorId: input.operatorId,
      adapterName: input.adapterName,
      journalEntryIds: input.journalEntryIds,
      limit,
      occurredAt: input.occurredAt ?? this.now()
    });

    if (batch.entries.length === 0) {
      throw new PostingStateError('NO_POSTABLE_JOURNALS', 'No generated journal entries are ready to post');
    }

    return batch;
  }

  completePostingBatch(input: CompletePostingBatchInput): Promise<PostingBatch | null> {
    return this.repository.completePostingBatch({
      operatorId: input.operatorId,
      batchId: input.batchId,
      adapterName: input.adapterName,
      results: input.results,
      occurredAt: input.occurredAt ?? this.now()
    });
  }
}

export class InMemoryPostingRepository implements PostingRepository {
  readonly entries: JournalLogEntry[] = [];
  readonly attempts: PostingAttempt[] = [];
  readonly batches: PostingBatch[] = [];

  async listJournalEntries(input: ListJournalEntriesInput & {
    limit: number;
    offset: number;
  }): Promise<ListPage<JournalLogEntry>> {
    const filtered = this.entries.filter((entry) => {
      if (entry.operatorId !== input.operatorId) return false;
      return input.postingStatus ? entry.postingStatus === input.postingStatus : true;
    });

    return {
      records: filtered.slice(input.offset, input.offset + input.limit),
      page: {
        limit: input.limit,
        offset: input.offset,
        total: filtered.length
      }
    };
  }

  async findJournalEntry(input: {
    operatorId: string;
    journalEntryId: string;
  }): Promise<JournalLogEntry | null> {
    return (
      this.entries.find(
        (entry) => entry.operatorId === input.operatorId && entry.id === input.journalEntryId
      ) ?? null
    );
  }

  async requestManualRetry(input: ManualRetryInput & {
    occurredAt: string;
  }): Promise<JournalLogEntry | null> {
    const entry = await this.findJournalEntry(input);
    if (!entry) return null;

    const attempt: PostingAttempt = {
      id: randomUUID(),
      operatorId: input.operatorId,
      journalEntryId: input.journalEntryId,
      adapterName: input.adapterName,
      status: 'retry_requested',
      attemptNumber: entry.attemptCount + 1,
      requestedByUserId: input.requestedByUserId || undefined,
      occurredAt: input.occurredAt
    };
    this.attempts.push(attempt);

    entry.postingStatus = 'generated';
    entry.lastPostingAttemptAt = input.occurredAt;
    entry.lastPostingError = undefined;
    entry.attemptCount += 1;
    entry.latestAttempt = attempt;
    return entry;
  }

  async createPostingBatch(input: CreatePostingBatchInput & {
    limit: number;
    occurredAt: string;
  }): Promise<PostingBatch> {
    const entries = this.entries
      .filter((entry) => {
        if (entry.operatorId !== input.operatorId || entry.postingStatus !== 'generated') return false;
        return input.journalEntryIds ? input.journalEntryIds.includes(entry.id) : true;
      })
      .slice(0, input.limit);

    const batch: PostingBatch = {
      id: randomUUID(),
      operatorId: input.operatorId,
      adapterName: input.adapterName,
      status: 'posting',
      journalEntryCount: entries.length,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
      entries
    };
    this.batches.push(batch);

    for (const entry of entries) {
      const attempt: PostingAttempt = {
        id: randomUUID(),
        operatorId: input.operatorId,
        journalEntryId: entry.id,
        postingBatchId: batch.id,
        adapterName: input.adapterName,
        status: 'posting',
        attemptNumber: entry.attemptCount + 1,
        occurredAt: input.occurredAt
      };
      this.attempts.push(attempt);
      entry.postingStatus = 'posting';
      entry.lastPostingAttemptAt = input.occurredAt;
      entry.attemptCount += 1;
      entry.latestAttempt = attempt;
      entry.attempts = [attempt, ...entry.attempts];
    }

    return batch;
  }

  async completePostingBatch(input: CompletePostingBatchInput & {
    occurredAt: string;
  }): Promise<PostingBatch | null> {
    const batch = this.batches.find(
      (item) =>
        item.operatorId === input.operatorId &&
        item.id === input.batchId &&
        item.adapterName === input.adapterName
    );
    if (!batch) return null;

    const resultByEntryId = new Map(input.results.map((result) => [result.journalEntryId, result]));

    for (const entry of batch.entries) {
      const result = resultByEntryId.get(entry.id);
      if (!result) continue;

      const attempt = this.attempts.find(
        (item) => item.postingBatchId === batch.id && item.journalEntryId === entry.id
      );
      if (attempt) {
        attempt.status = result.status;
        attempt.externalReference = result.externalReference;
        attempt.errorCode = result.errorCode;
        attempt.errorMessage = result.errorMessage;
        attempt.occurredAt = input.occurredAt;
      }

      entry.postingStatus = result.status;
      entry.postedAt = result.status === 'posted' ? input.occurredAt : undefined;
      entry.lastPostingAttemptAt = input.occurredAt;
      entry.lastPostingError = result.status === 'failed' ? result.errorMessage : undefined;
      entry.latestAttempt = attempt;
    }

    batch.status = input.results.some((result) => result.status === 'failed') ? 'failed' : 'posted';
    batch.updatedAt = input.occurredAt;
    return batch;
  }
}
