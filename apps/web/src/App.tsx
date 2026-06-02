import { FormEvent, useEffect, useMemo, useState } from 'react';

type Screen = 'transactions' | 'mapping-rules' | 'journal-log' | 'settings';
type SettingsTab = 'coa' | 'schema' | 'adapters' | 'users' | 'system';
type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
type PostingDisplayStatus = JournalEntry['posting_status'] | 'unposted' | 'blocked';
type TransactionStatusFilter = TransactionRecord['status'] | 'all';

interface ChartAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
  active: boolean;
}

interface CreditSplit {
  accountCode: string;
  percentageBps: number;
}

interface MappingRule {
  id: string;
  productLine: string;
  biller?: string;
  billerCategory?: string;
  transactionType?: string;
  debitAccountCode: string;
  status: 'active' | 'inactive';
  version: number;
  creditSplits: CreditSplit[];
}

interface TransactionRecord {
  id: string;
  source_id?: string;
  source: {
    adapter: string;
    system: string;
    environment?: 'live' | 'test';
  };
  occurred_at: string;
  settled_at: string | null;
  status: 'pending' | 'settled' | 'failed' | 'reversed' | 'disputed';
  posting_status: 'unposted';
  type: string;
  direction: 'debit' | 'credit';
  amount: number;
  currency: string;
  product: {
    line: string;
    biller?: string;
    biller_category?: string;
  };
  channel: string;
  dedupe_confidence: 'high' | 'low';
  ingested_at: string;
}

interface JournalLine {
  account_code: string;
  side: 'debit' | 'credit';
  amount: number;
  currency: string;
  line_order: number;
}

interface JournalEntry {
  id: string;
  transaction_id: string;
  entry_type: 'standard' | 'reversal' | 'unmapped';
  status: 'generated' | 'unmapped';
  posting_status: 'generated' | 'posting' | 'posted' | 'failed' | 'unmapped' | 'retry_exhausted';
  currency: string;
  amount: number;
  mapping_rule_id?: string;
  mapping_rule_version?: number;
  generated_at: string;
  posted_at?: string;
  last_posting_attempt_at?: string;
  last_posting_error?: string;
  attempt_count: number;
  lines: JournalLine[];
  latest_attempt?: {
    adapter_name: string;
    status: string;
    attempt_number: number;
    occurred_at: string;
    error_message?: string;
  };
  attempts: Array<{
    id: string;
    adapter_name: string;
    status: string;
    attempt_number: number;
    occurred_at: string;
    error_message?: string;
    external_reference?: string;
  }>;
  transaction?: {
    id: string;
    source_id?: string;
    status: string;
    type: string;
    occurred_at: string;
    settled_at?: string | null;
    source_adapter: string;
    source_system: string;
    product_line: string;
    product_biller?: string;
    product_biller_category?: string;
  };
}

interface RuleFormState {
  id?: string;
  productLine: string;
  biller: string;
  billerCategory: string;
  transactionType: string;
  debitAccountCode: string;
  creditSplits: CreditSplit[];
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

const emptyRuleForm: RuleFormState = {
  productLine: 'consumer-app',
  biller: '',
  billerCategory: '',
  transactionType: '',
  debitAccountCode: '',
  creditSplits: [{ accountCode: '', percentageBps: 10000 }]
};

export function App() {
  const [screen, setScreen] = useState<Screen>('mapping-rules');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('coa');
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [rules, setRules] = useState<MappingRule[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [transactionFilter, setTransactionFilter] = useState<'all' | 'unmapped'>('all');
  const [transactionStatusFilter, setTransactionStatusFilter] = useState<TransactionStatusFilter>('all');
  const [transactionPostingFilter, setTransactionPostingFilter] = useState<PostingDisplayStatus | 'all'>('all');
  const [transactionDateFrom, setTransactionDateFrom] = useState('');
  const [transactionDateTo, setTransactionDateTo] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionRecord | null>(null);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalFilter, setJournalFilter] = useState<JournalEntry['posting_status'] | 'all'>('all');
  const [selectedJournal, setSelectedJournal] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [ruleForm, setRuleForm] = useState<RuleFormState>(emptyRuleForm);
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const [coaForm, setCoaForm] = useState({
    code: '',
    name: '',
    type: 'asset' as AccountType
  });

  useEffect(() => {
    void refreshOperationalData();
  }, [journalFilter]);

  const activeRules = rules.filter((rule) => rule.status === 'active');
  const inactiveRules = rules.filter((rule) => rule.status === 'inactive');
  const productLineCount = new Set(rules.map((rule) => rule.productLine)).size;

  const creditSplitTotal = useMemo(
    () => ruleForm.creditSplits.reduce((sum, split) => sum + Number(split.percentageBps || 0), 0),
    [ruleForm.creditSplits]
  );

  async function refreshOperationalData() {
    setLoading(true);
    setError('');

    try {
      const journalPath =
        journalFilter === 'all'
          ? '/api/journal-entries'
          : `/api/journal-entries?posting_status=${journalFilter}`;
      const [coaResponse, rulesResponse, transactionResponse, journalResponse] = await Promise.all([
        apiGet<{ records: ChartAccount[] }>('/api/coa'),
        apiGet<{ records: MappingRule[] }>('/api/mapping-rules'),
        apiGet<{ records: TransactionRecord[] }>('/api/transactions'),
        apiGet<{ records: JournalEntry[] }>(journalPath)
      ]);
      setAccounts(coaResponse.records);
      setRules(rulesResponse.records);
      setTransactions(transactionResponse.records);
      setJournalEntries(journalResponse.records);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load Ledgerise data');
    } finally {
      setLoading(false);
    }
  }

  async function saveCoaAccount(event: FormEvent) {
    event.preventDefault();
    setError('');

    try {
      await apiPost('/api/coa/import', {
        accounts: [coaForm]
      });
      setNotice(`Imported COA account ${coaForm.code}`);
      setCoaForm({ code: '', name: '', type: 'asset' });
      await refreshOperationalData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to import account');
    }
  }

  async function saveRule(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (creditSplitTotal !== 10000) {
      setError('Credit splits must sum to 100%.');
      return;
    }

    const payload = {
      product_line: ruleForm.productLine,
      biller: ruleForm.biller || undefined,
      biller_category: ruleForm.billerCategory || undefined,
      transaction_type: ruleForm.transactionType || undefined,
      debit_account_code: ruleForm.debitAccountCode,
      credit_splits: ruleForm.creditSplits.map((split) => ({
        account_code: split.accountCode,
        percentage_bps: Number(split.percentageBps)
      }))
    };

    try {
      if (ruleForm.id) {
        await apiPatch(`/api/mapping-rules/${ruleForm.id}`, payload);
        setNotice('Mapping rule updated');
      } else {
        await apiPost('/api/mapping-rules', payload);
        setNotice('Mapping rule created');
      }
      setRuleForm(emptyRuleForm);
      setRuleDrawerOpen(false);
      await refreshOperationalData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save mapping rule');
    }
  }

  async function toggleRule(rule: MappingRule) {
    const action = rule.status === 'active' ? 'deactivate' : 'activate';
    setError('');

    try {
      await apiPost(`/api/mapping-rules/${rule.id}/${action}`, {});
      setNotice(`Rule ${action}d`);
      await refreshOperationalData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to change rule status');
    }
  }

  function editRule(rule: MappingRule) {
    setRuleForm({
      id: rule.id,
      productLine: rule.productLine,
      biller: rule.biller ?? '',
      billerCategory: rule.billerCategory ?? '',
      transactionType: rule.transactionType ?? '',
      debitAccountCode: rule.debitAccountCode,
      creditSplits:
        rule.creditSplits.length > 0
          ? rule.creditSplits
          : [{ accountCode: '', percentageBps: 10000 }]
    });
    setRuleDrawerOpen(true);
  }

  function openNewRule() {
    setRuleForm(emptyRuleForm);
    setError('');
    setRuleDrawerOpen(true);
  }

  function closeRuleDrawer() {
    setRuleDrawerOpen(false);
  }

  function updateSplit(index: number, patch: Partial<CreditSplit>) {
    setRuleForm((current) => ({
      ...current,
      creditSplits: current.creditSplits.map((split, splitIndex) =>
        splitIndex === index ? { ...split, ...patch } : split
      )
    }));
  }

  function removeSplit(index: number) {
    setRuleForm((current) => ({
      ...current,
      creditSplits: current.creditSplits.filter((_, splitIndex) => splitIndex !== index)
    }));
  }

  async function retryJournalEntry(entry: JournalEntry) {
    setError('');
    try {
      await apiPost(`/api/journal-entries/${entry.id}/retry`, {
        adapter_name: 'generic-journal-csv'
      });
      setNotice('Retry requested');
      await refreshOperationalData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to request retry');
    }
  }

  function closeJournalDrawer() {
    setSelectedJournal(null);
  }

  function closeTransactionDrawer() {
    setSelectedTransaction(null);
  }

  function mapTransaction(transaction: TransactionRecord) {
    setRuleForm({
      ...emptyRuleForm,
      productLine: transaction.product.line,
      biller: transaction.product.biller ?? '',
      billerCategory: transaction.product.biller_category ?? '',
      transactionType: transaction.type
    });
    setSelectedTransaction(null);
    setScreen('mapping-rules');
    setRuleDrawerOpen(true);
  }

  function openTransactionJournal(entry: JournalEntry) {
    setSelectedTransaction(null);
    setSelectedJournal(entry);
    setScreen('journal-log');
  }

  return (
    <div className="layout">
      <nav className="topnav">
        <div className="topnav-logo">
          <div className="logo-mark">
            <img src="/ledgerise-logo.svg" alt="" aria-hidden="true" />
          </div>
          <span className="logo-wordmark">Ledgerise</span>
          <span className="logo-version">v0.1</span>
        </div>

        <div className="topnav-nav">
          <NavButton active={screen === 'transactions'} onClick={() => setScreen('transactions')}>
            Transactions
          </NavButton>
          <NavButton active={screen === 'mapping-rules'} onClick={() => setScreen('mapping-rules')}>
            Mapping Rules
          </NavButton>
          <NavButton active={screen === 'journal-log'} onClick={() => setScreen('journal-log')}>
            Journal Log
          </NavButton>
          <NavButton active={screen === 'settings'} onClick={() => setScreen('settings')}>
            Settings
          </NavButton>
        </div>
      </nav>

      <main className="main">
        {notice ? <Toast message={notice} onClose={() => setNotice('')} /> : null}
        {screen === 'transactions' ? (
          <TransactionsView
            journalEntries={journalEntries}
            loading={loading}
            mapTransaction={mapTransaction}
            selectedTransaction={selectedTransaction}
            selectTransaction={setSelectedTransaction}
            closeTransactionDrawer={closeTransactionDrawer}
            transactionFilter={transactionFilter}
            setTransactionFilter={setTransactionFilter}
            statusFilter={transactionStatusFilter}
            setStatusFilter={setTransactionStatusFilter}
            postingFilter={transactionPostingFilter}
            setPostingFilter={setTransactionPostingFilter}
            dateFrom={transactionDateFrom}
            setDateFrom={setTransactionDateFrom}
            dateTo={transactionDateTo}
            setDateTo={setTransactionDateTo}
            openTransactionJournal={openTransactionJournal}
            transactions={transactions}
          />
        ) : null}
        {screen === 'journal-log' ? (
          <JournalLogView
            accounts={accounts}
            entries={journalEntries}
            error={error}
            filter={journalFilter}
            loading={loading}
            retryJournalEntry={retryJournalEntry}
            selectedJournal={selectedJournal}
            selectJournal={setSelectedJournal}
            closeJournalDrawer={closeJournalDrawer}
            setFilter={setJournalFilter}
          />
        ) : null}
        {screen === 'mapping-rules' ? (
          <MappingRulesView
            accounts={accounts}
            activeRules={activeRules.length}
            inactiveRules={inactiveRules.length}
            loading={loading}
            productLineCount={productLineCount}
            rules={rules}
            error={error}
            ruleForm={ruleForm}
            ruleDrawerOpen={ruleDrawerOpen}
            creditSplitTotal={creditSplitTotal}
            setRuleForm={setRuleForm}
            saveRule={saveRule}
            openNewRule={openNewRule}
            closeRuleDrawer={closeRuleDrawer}
            editRule={editRule}
            toggleRule={toggleRule}
            updateSplit={updateSplit}
            removeSplit={removeSplit}
          />
        ) : null}
        {screen === 'settings' ? (
          <SettingsView
            settingsTab={settingsTab}
            setSettingsTab={setSettingsTab}
            accounts={accounts}
            coaForm={coaForm}
            setCoaForm={setCoaForm}
            saveCoaAccount={saveCoaAccount}
            error={error}
          />
        ) : null}
      </main>
    </div>
  );
}

function NavButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button className={`nav-tab${active ? ' active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function TransactionsView(props: {
  journalEntries: JournalEntry[];
  loading: boolean;
  mapTransaction: (transaction: TransactionRecord) => void;
  selectedTransaction: TransactionRecord | null;
  selectTransaction: (transaction: TransactionRecord) => void;
  closeTransactionDrawer: () => void;
  transactionFilter: 'all' | 'unmapped';
  setTransactionFilter: (filter: 'all' | 'unmapped') => void;
  statusFilter: TransactionStatusFilter;
  setStatusFilter: (filter: TransactionStatusFilter) => void;
  postingFilter: PostingDisplayStatus | 'all';
  setPostingFilter: (filter: PostingDisplayStatus | 'all') => void;
  dateFrom: string;
  setDateFrom: (value: string) => void;
  dateTo: string;
  setDateTo: (value: string) => void;
  openTransactionJournal: (entry: JournalEntry) => void;
  transactions: TransactionRecord[];
}) {
  const {
    journalEntries,
    loading,
    mapTransaction,
    selectedTransaction,
    selectTransaction,
    closeTransactionDrawer,
    transactionFilter,
    setTransactionFilter,
    statusFilter,
    setStatusFilter,
    postingFilter,
    setPostingFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    openTransactionJournal,
    transactions
  } = props;
  const settled = transactions.filter((transaction) => transaction.status === 'settled').length;
  const pending = transactions.filter((transaction) => transaction.status === 'pending').length;
  const unmapped = transactions.filter(
    (transaction) => transactionJournalStatus(transaction, journalEntries) === 'unmapped'
  ).length;
  const test = transactions.filter((transaction) => transaction.source.environment === 'test').length;
  const visibleTransactions = transactions.filter((transaction) => {
    const journalStatus = transactionJournalStatus(transaction, journalEntries);
    if (transactionFilter === 'unmapped' && journalStatus !== 'unmapped') return false;
    if (statusFilter !== 'all' && transaction.status !== statusFilter) return false;
    if (postingFilter !== 'all' && journalStatus !== postingFilter) return false;
    return transactionWithinDateRange(transaction, dateFrom, dateTo);
  });

  return (
    <section className="screen active">
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p>Canonical records ingested by inbound adapters before mapping and journal generation</p>
        </div>
      </div>

      <div className="stat-bar cols-4">
        <StatCell label="Total" value={String(transactions.length)} sub="canonical records stored" />
        <StatCell label="Settled" value={String(settled)} sub="eligible for journal generation" tone="ok" />
        <StatCell label="Unmapped" value={String(unmapped)} sub="journaled to suspense" tone={unmapped ? 'warn' : undefined} />
        <StatCell label="Pending/Test" value={String(pending + test)} sub="blocked from posting" />
      </div>

      <div className="table-workspace">
        <div className="filter-bar">
          <input className="fi" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} style={{ width: 140 }} />
          <span style={{ color: 'var(--color-text-3)', fontSize: 'var(--text-sm)' }}>to</span>
          <input className="fi" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} style={{ width: 140 }} />
          <div className="bar-sep" />
          <select
            className="fi"
            style={{ width: 145 }}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as TransactionStatusFilter)}
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="settled">Settled</option>
            <option value="failed">Failed</option>
            <option value="reversed">Reversed</option>
            <option value="disputed">Disputed</option>
          </select>
          <select
            className="fi"
            style={{ width: 165 }}
            value={postingFilter}
            onChange={(event) => setPostingFilter(event.target.value as PostingDisplayStatus | 'all')}
          >
            <option value="all">All Posting Status</option>
            <option value="unposted">Unposted</option>
            <option value="generated">Generated</option>
            <option value="posting">Posting</option>
            <option value="posted">Posted</option>
            <option value="failed">Failed</option>
            <option value="unmapped">Unmapped</option>
            <option value="retry_exhausted">Retry exhausted</option>
            <option value="blocked">Blocked/Test</option>
          </select>
          <select className="fi" style={{ width: 170 }}>
            <option>All Adapters</option>
          </select>
          <input className="fi" placeholder="Search transaction ID..." style={{ width: 240 }} />
          <button
            className={`btn btn-ghost btn-sm${transactionFilter === 'unmapped' ? ' active-filter' : ''}`}
            onClick={() => setTransactionFilter(transactionFilter === 'unmapped' ? 'all' : 'unmapped')}
          >
            Unmapped only
          </button>
          <div className="spacer" />
          <span className="stat-sub">{loading ? 'Loading transactions...' : `${visibleTransactions.length} transactions`}</span>
        </div>

        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Dir</th>
                <th>Status</th>
                <th>Posting</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTransactions.map((transaction) => {
                const journalStatus = transactionJournalStatus(transaction, journalEntries);
                return (
                  <tr key={transaction.id} onClick={() => selectTransaction(transaction)}>
                    <td className="mono">{transaction.source_id ?? shortId(transaction.id)}</td>
                    <td>{formatDate(transaction.occurred_at)}</td>
                    <td><span className="type-tag">{transaction.type}</span></td>
                    <td className="amt">{formatMoney(transaction.amount, transaction.currency)}</td>
                    <td><span className={`dir-badge ${transaction.direction}`}>{transaction.direction === 'debit' ? 'DR' : 'CR'}</span></td>
                    <td><span className={`badge ${transactionStatusClass(transaction.status)}`}>{transaction.status}</span></td>
                    <td><span className={`badge ${postingBadgeClass(journalStatus)}`}>{formatStatusLabel(journalStatus)}</span></td>
                    <td>
                      <div className="mono">{transaction.source.adapter}</div>
                      <div className="dim" style={{ fontSize: 11 }}>{transaction.source.environment ?? 'live'} · {transaction.dedupe_confidence}</div>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      {journalStatus === 'unmapped' ? (
                        <button className="btn-link primary" onClick={() => mapTransaction(transaction)}>Map</button>
                      ) : (
                        <button className="btn-link primary" onClick={() => selectTransaction(transaction)}>View</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visibleTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="dim">No transactions found. Ingest canonical records through an inbound adapter to populate this table.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`drawer-overlay${selectedTransaction ? ' open' : ''}`} onClick={closeTransactionDrawer} />
      <aside className={`drawer${selectedTransaction ? ' open' : ''}`} aria-hidden={!selectedTransaction}>
        <div className="drawer-header">
          <div className="drawer-hd">
            <h2>Transaction</h2>
            <div className="mono-id">{selectedTransaction?.source_id ?? selectedTransaction?.id}</div>
          </div>
          <button className="drawer-close" type="button" onClick={closeTransactionDrawer} aria-label="Close transaction drawer">
            ×
          </button>
        </div>
        {selectedTransaction ? (
          <TransactionDrawer
            journalEntries={journalEntries}
            mapTransaction={mapTransaction}
            openTransactionJournal={openTransactionJournal}
            transaction={selectedTransaction}
            closeTransactionDrawer={closeTransactionDrawer}
          />
        ) : null}
      </aside>
    </section>
  );
}

function TransactionDrawer(props: {
  journalEntries: JournalEntry[];
  mapTransaction: (transaction: TransactionRecord) => void;
  openTransactionJournal: (entry: JournalEntry) => void;
  transaction: TransactionRecord;
  closeTransactionDrawer: () => void;
}) {
  const { journalEntries, mapTransaction, openTransactionJournal, transaction, closeTransactionDrawer } = props;
  const journalEntry = journalEntries.find((entry) => entry.transaction_id === transaction.id);
  const journalStatus = transactionJournalStatus(transaction, journalEntries);

  return (
    <>
      <div className="drawer-body">
        <div className="drawer-section">
          <div className="drawer-section-title">Canonical Record</div>
          <div className="drawer-grid">
            <DetailField label="Source ID" value={transaction.source_id ?? '-'} mono />
            <DetailField label="Internal ID" value={transaction.id} mono />
            <DetailField label="Type" value={transaction.type} mono />
            <DetailField label="Amount" value={formatMoney(transaction.amount, transaction.currency)} strong />
            <DetailField label="Direction" value={transaction.direction} />
            <DetailField label="Channel" value={transaction.channel} />
            <DetailField label="Status" value={transaction.status} />
            <DetailField label="Environment" value={transaction.source.environment ?? 'live'} />
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Product & Source</div>
          <div className="drawer-grid">
            <DetailField label="Product Line" value={transaction.product.line} />
            <DetailField label="Biller" value={transaction.product.biller ?? '-'} />
            <DetailField label="Biller Category" value={transaction.product.biller_category ?? '-'} />
            <DetailField label="Adapter" value={transaction.source.adapter} mono />
            <DetailField label="Source System" value={transaction.source.system} />
            <DetailField label="Dedupe Confidence" value={transaction.dedupe_confidence} />
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Timing</div>
          <div className="drawer-grid">
            <DetailField label="Occurred At" value={formatDateTime(transaction.occurred_at)} />
            <DetailField label="Settled At" value={transaction.settled_at ? formatDateTime(transaction.settled_at) : '-'} />
            <DetailField label="Ingested At" value={formatDateTime(transaction.ingested_at)} />
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Journal Entry</div>
          {journalEntry ? (
            <div className="drawer-grid">
              <DetailField label="Journal ID" value={shortId(journalEntry.id)} mono />
              <DetailField label="Posting Status" value={formatStatusLabel(journalEntry.posting_status)} />
              <DetailField label="Entry Type" value={journalEntry.entry_type} />
              <DetailField label="Generated At" value={formatDateTime(journalEntry.generated_at)} />
              <DetailField
                label="Rule Applied"
                value={journalEntry.mapping_rule_id ? `${shortId(journalEntry.mapping_rule_id)} · v${journalEntry.mapping_rule_version ?? 1}` : 'No rule matched - suspense'}
                mono={Boolean(journalEntry.mapping_rule_id)}
              />
            </div>
          ) : transaction.source.environment === 'test' ? (
            <span className="badge test-env">Test env - blocked from posting</span>
          ) : transaction.status !== 'settled' && transaction.status !== 'reversed' ? (
            <span className="dim" style={{ fontSize: 'var(--text-xs)' }}>Awaiting settlement before journal generation</span>
          ) : (
            <span className="dim" style={{ fontSize: 'var(--text-xs)' }}>Eligible but no journal entry generated yet</span>
          )}
        </div>
      </div>

      <div className="drawer-footer">
        <span className={`badge ${postingBadgeClass(journalStatus)}`}>{formatStatusLabel(journalStatus)}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={closeTransactionDrawer}>Close</button>
          {journalEntry ? (
            <button className="btn btn-secondary btn-sm" onClick={() => openTransactionJournal(journalEntry)}>Open Journal Entry</button>
          ) : null}
          {journalStatus === 'unmapped' ? (
            <button className="btn btn-primary btn-sm" onClick={() => mapTransaction(transaction)}>Map Transaction</button>
          ) : null}
        </div>
      </div>
    </>
  );
}

function MappingRulesView(props: {
  accounts: ChartAccount[];
  activeRules: number;
  inactiveRules: number;
  productLineCount: number;
  loading: boolean;
  rules: MappingRule[];
  error: string;
  ruleForm: RuleFormState;
  ruleDrawerOpen: boolean;
  creditSplitTotal: number;
  setRuleForm: (updater: RuleFormState | ((current: RuleFormState) => RuleFormState)) => void;
  saveRule: (event: FormEvent) => void;
  openNewRule: () => void;
  closeRuleDrawer: () => void;
  editRule: (rule: MappingRule) => void;
  toggleRule: (rule: MappingRule) => void;
  updateSplit: (index: number, patch: Partial<CreditSplit>) => void;
  removeSplit: (index: number) => void;
}) {
  const {
    accounts,
    activeRules,
    inactiveRules,
    productLineCount,
    loading,
    rules,
    error,
    ruleForm,
    ruleDrawerOpen,
    creditSplitTotal,
    setRuleForm,
    saveRule,
    openNewRule,
    closeRuleDrawer,
    editRule,
    toggleRule,
    updateSplit,
    removeSplit
  } = props;

  return (
    <section className="screen active">
      <div className="page-header">
        <div>
          <h1>Mapping Rules</h1>
          <p>Configure which COA accounts to debit and credit per transaction pattern</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={openNewRule}>
            Add Rule
          </button>
        </div>
      </div>

      <div className="stat-bar cols-3">
        <StatCell label="Active Rules" value={String(activeRules)} sub={`across ${productLineCount} product lines`} tone="ok" />
        <StatCell label="COA Accounts" value={String(accounts.length)} sub="available for mappings" />
        <StatCell label="Inactive Rules" value={String(inactiveRules)} sub="manually deactivated" />
      </div>

      <div className="table-workspace">
        <div className="filter-bar">
          <input className="fi" placeholder="Search biller or account code..." style={{ width: 280 }} />
          <div className="spacer" />
          <span className="stat-sub">{loading ? 'Loading rules...' : `${rules.length} rules`}</span>
        </div>
        <div className="table-wrap">
          <table className="tbl">
              <thead>
                <tr>
                  <th>Product Line</th>
                  <th>Biller</th>
                  <th>Category</th>
                  <th>Type Filter</th>
                  <th>Debit Account</th>
                  <th>Credit Account(s)</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} onClick={() => editRule(rule)}>
                    <td style={{ fontWeight: 500 }}>{rule.productLine}</td>
                    <td className={rule.biller ? '' : 'dim'}>{rule.biller || '-'}</td>
                    <td className={rule.billerCategory ? '' : 'dim'}>{rule.billerCategory || '-'}</td>
                    <td>{rule.transactionType ? <span className="type-tag">{rule.transactionType}</span> : <span className="dim">Catch-all</span>}</td>
                    <td>{accountChip(rule.debitAccountCode, accounts)}</td>
                    <td>
                      <div className="chip-stack">
                        {rule.creditSplits.map((split) => (
                          <span key={`${rule.id}-${split.accountCode}`}>
                            {accountChip(split.accountCode, accounts)}{' '}
                            <span className="dim" style={{ fontSize: 11 }}>
                              {formatBps(split.percentageBps)}
                            </span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td><span className={`badge ${rule.status === 'active' ? 'active-rule' : 'failed'}`}>{rule.status}</span></td>
                    <td className="mono">{rule.version}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <label className="toggle" title="Toggle active">
                          <input type="checkbox" checked={rule.status === 'active'} onChange={() => void toggleRule(rule)} />
                          <span className="toggle-track" />
                          <span className="toggle-thumb" />
                        </label>
                        <button className="btn-link primary" onClick={() => editRule(rule)}>Edit</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="dim">No mapping rules yet. Create the first rule from Add Rule.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
      </div>

      <div className={`drawer-overlay${ruleDrawerOpen ? ' open' : ''}`} onClick={closeRuleDrawer} />
      <aside className={`drawer${ruleDrawerOpen ? ' open' : ''}`} aria-hidden={!ruleDrawerOpen}>
        <div className="drawer-header">
          <div className="drawer-hd">
            <h2>{ruleForm.id ? 'Edit Mapping Rule' : 'Add Mapping Rule'}</h2>
            <div className="mono-id">Configure debit and credit accounts for a transaction pattern</div>
          </div>
          <button className="drawer-close" type="button" onClick={closeRuleDrawer} aria-label="Close mapping rule drawer">
            ×
          </button>
        </div>
        <RuleEditor
          accounts={accounts}
          error={error}
          ruleForm={ruleForm}
          creditSplitTotal={creditSplitTotal}
          setRuleForm={setRuleForm}
          saveRule={saveRule}
          updateSplit={updateSplit}
          removeSplit={removeSplit}
          closeRuleDrawer={closeRuleDrawer}
        />
      </aside>
    </section>
  );
}

function JournalLogView(props: {
  accounts: ChartAccount[];
  entries: JournalEntry[];
  error: string;
  filter: JournalEntry['posting_status'] | 'all';
  loading: boolean;
  retryJournalEntry: (entry: JournalEntry) => void;
  selectedJournal: JournalEntry | null;
  selectJournal: (entry: JournalEntry) => void;
  closeJournalDrawer: () => void;
  setFilter: (filter: JournalEntry['posting_status'] | 'all') => void;
}) {
  const {
    accounts,
    entries,
    error,
    filter,
    loading,
    retryJournalEntry,
    selectedJournal,
    selectJournal,
    closeJournalDrawer,
    setFilter
  } = props;
  const posted = entries.filter((entry) => entry.posting_status === 'posted').length;
  const failed = entries.filter((entry) => ['failed', 'retry_exhausted'].includes(entry.posting_status)).length;
  const unmapped = entries.filter((entry) => entry.posting_status === 'unmapped').length;
  const generated = entries.filter((entry) => entry.posting_status === 'generated').length;
  const lastGeneratedAt = entries[0]?.generated_at;

  return (
    <section className="screen active">
      <div className="page-header">
        <div>
          <h1>Journal Log</h1>
          <p>Double-entry records generated by the engine and queued for outbound accounting adapters</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => exportJournalEntriesCsv(entries, accounts, filter)}>
            Export CSV
          </button>
          <button className="btn btn-primary" onClick={() => setFilter('generated')}>
            Run Engine Now
          </button>
        </div>
      </div>

      <div className="stat-bar cols-4">
        <StatCell label="Generated" value={String(generated)} sub="ready for outbound posting" />
        <StatCell label="Posted" value={String(posted)} sub="accepted by accounting system" tone="ok" />
        <StatCell label="Failed" value={String(failed)} sub="failed or retry-exhausted entries" tone={failed ? 'bad' : undefined} />
        <StatCell label="Unmapped" value={String(unmapped)} sub="parked in suspense" tone={unmapped ? 'warn' : undefined} />
      </div>

      <div className="table-workspace">
        <div className="filter-bar">
          <input className="fi" type="date" style={{ width: 140 }} />
          <span style={{ color: 'var(--color-text-3)', fontSize: 'var(--text-sm)' }}>to</span>
          <input className="fi" type="date" style={{ width: 140 }} />
          <div className="bar-sep" />
          <select className="fi" value={filter} onChange={(event) => setFilter(event.target.value as JournalEntry['posting_status'] | 'all')}>
            <option value="all">All statuses</option>
            <option value="generated">Generated</option>
            <option value="posting">Posting</option>
            <option value="posted">Posted</option>
            <option value="failed">Failed</option>
            <option value="unmapped">Unmapped</option>
            <option value="retry_exhausted">Retry exhausted</option>
          </select>
          <button
            className={`btn btn-ghost btn-sm${filter === 'failed' || filter === 'unmapped' ? ' active-filter' : ''}`}
            onClick={() => setFilter(filter === 'failed' || filter === 'unmapped' ? 'all' : failed ? 'failed' : 'unmapped')}
          >
            Failed & unmapped only
          </button>
          <div className="spacer" />
          <span className="stat-sub">
            {loading
              ? 'Loading journal entries...'
              : `${entries.length} entries${lastGeneratedAt ? ` · last generated ${formatDateTime(lastGeneratedAt)}` : ''}`}
          </span>
        </div>
        {error ? <div className="form-error journal-error">{error}</div> : null}
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Journal ID</th>
                <th>Transaction ID</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Posting Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} onClick={() => selectJournal(entry)}>
                  <td className="mono">{shortId(entry.id)}</td>
                  <td className="mono">{entry.transaction?.source_id ?? shortId(entry.transaction_id)}</td>
                  <td>{formatDate(entry.transaction?.occurred_at ?? entry.generated_at)}</td>
                  <td className="amt">{formatMoney(entry.amount, entry.currency)}</td>
                  <td>{journalSideChips(entry, 'debit', accounts)}</td>
                  <td>{journalSideChips(entry, 'credit', accounts)}</td>
                  <td><span className={`badge ${postingBadgeClass(entry.posting_status)}`}>{formatStatusLabel(entry.posting_status)}</span></td>
                  <td onClick={(event) => event.stopPropagation()}>
                    {['failed', 'retry_exhausted'].includes(entry.posting_status) ? (
                      <button className="btn-link danger" onClick={() => void retryJournalEntry(entry)}>
                        Retry
                      </button>
                    ) : (
                      <button className="btn-link primary" onClick={() => selectJournal(entry)}>View</button>
                    )}
                  </td>
                </tr>
              ))}
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="dim">No journal entries found for this filter.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`drawer-overlay${selectedJournal ? ' open' : ''}`} onClick={closeJournalDrawer} />
      <aside className={`drawer${selectedJournal ? ' open' : ''}`} aria-hidden={!selectedJournal}>
        <div className="drawer-header">
          <div className="drawer-hd">
            <h2>Journal Entry</h2>
            <div className="mono-id">{selectedJournal?.id}</div>
          </div>
          <button className="drawer-close" type="button" onClick={closeJournalDrawer} aria-label="Close journal drawer">
            ×
          </button>
        </div>
        {selectedJournal ? (
          <JournalDrawer
            accounts={accounts}
            entry={selectedJournal}
            retryJournalEntry={retryJournalEntry}
            closeJournalDrawer={closeJournalDrawer}
          />
        ) : null}
      </aside>
    </section>
  );
}

function JournalDrawer(props: {
  accounts: ChartAccount[];
  entry: JournalEntry;
  retryJournalEntry: (entry: JournalEntry) => void;
  closeJournalDrawer: () => void;
}) {
  const { accounts, entry, retryJournalEntry, closeJournalDrawer } = props;
  const transaction = entry.transaction;

  return (
    <>
      <div className="drawer-body">
        <div className="drawer-section">
          <div className="drawer-section-title">Entry Lines</div>
          {entry.entry_type === 'reversal' ? (
            <div className="reversal-notice">Reversal entry - debits and credits are swapped from the original journal entry.</div>
          ) : null}
          <div className="jlines">
            {entry.lines.map((line) => {
              const account = accounts.find((item) => item.code === line.account_code);
              return (
                <div className="jline" key={`${entry.id}-${line.line_order}`}>
                  <span className={`jline-type ${line.side === 'debit' ? 'dr' : 'cr'}`}>
                    {line.side === 'debit' ? 'DR' : 'CR'}
                  </span>
                  <div className="jline-acct">
                    <div className="jline-acct-code">{line.account_code}</div>
                    <div className="jline-acct-name">{account?.name ?? 'Unknown account'}</div>
                  </div>
                  <span className="jline-amt">{formatMoney(line.amount, line.currency)}</span>
                </div>
              );
            })}
          </div>
          {entry.posting_status === 'unmapped' ? (
            <p className="drawer-note">Parked in suspense pending rule assignment.</p>
          ) : null}
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Transaction</div>
          <div className="drawer-grid">
            <DetailField label="TX ID" value={transaction?.source_id ?? shortId(entry.transaction_id)} mono />
            <DetailField label="Date" value={formatDate(transaction?.occurred_at ?? entry.generated_at)} />
            <DetailField label="Type" value={transaction?.type ?? entry.entry_type} mono />
            <DetailField label="Amount" value={formatMoney(entry.amount, entry.currency)} strong />
            <DetailField label="Product Line" value={transaction?.product_line ?? '-'} />
            <DetailField label="Biller" value={transaction?.product_biller ?? '-'} />
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Mapping & Posting</div>
          <div className="drawer-grid">
            <DetailField
              label="Rule Applied"
              value={entry.mapping_rule_id ? `${shortId(entry.mapping_rule_id)} · v${entry.mapping_rule_version ?? 1}` : 'No rule matched - suspense'}
              mono={Boolean(entry.mapping_rule_id)}
            />
            <DetailField label="Adapter" value={entry.latest_attempt?.adapter_name ?? 'generic-journal-csv'} mono />
            <DetailField label="Attempts" value={String(entry.attempt_count)} />
            <DetailField label="Posted At" value={entry.posted_at ? formatDateTime(entry.posted_at) : '-'} />
            <DetailField label="Last Error" value={entry.last_posting_error ?? '-'} />
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Posting History</div>
          <div className="timeline">
            {journalTimeline(entry).map((item, index) => (
              <div className="timeline-item" key={`${item.event}-${index}`}>
                <div className={`tl-dot ${item.ok ? 'ok' : 'err'}`} />
                <div>
                  <div className="tl-event">{item.event}</div>
                  <div className="tl-time">{formatDateTime(item.time)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="drawer-footer">
        <span className={`badge ${postingBadgeClass(entry.posting_status)}`}>
          {formatStatusLabel(entry.posting_status)}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={closeJournalDrawer}>Close</button>
          {['failed', 'retry_exhausted'].includes(entry.posting_status) ? (
            <button className="btn btn-danger btn-sm" onClick={() => void retryJournalEntry(entry)}>Retry Now</button>
          ) : null}
        </div>
      </div>
    </>
  );
}

function RuleEditor(props: {
  accounts: ChartAccount[];
  error: string;
  ruleForm: RuleFormState;
  creditSplitTotal: number;
  setRuleForm: (updater: RuleFormState | ((current: RuleFormState) => RuleFormState)) => void;
  saveRule: (event: FormEvent) => void;
  updateSplit: (index: number, patch: Partial<CreditSplit>) => void;
  removeSplit: (index: number) => void;
  closeRuleDrawer: () => void;
}) {
  const { accounts, error, ruleForm, creditSplitTotal, setRuleForm, saveRule, updateSplit, removeSplit, closeRuleDrawer } = props;
  const canSave = creditSplitTotal === 10000 && ruleForm.productLine && ruleForm.debitAccountCode;

  return (
    <form className="rule-drawer-form" onSubmit={saveRule}>
      <div className="drawer-body">
        {error ? <div className="form-error">{error}</div> : null}

        <div className="drawer-section rule-match-section">
          <TextField label="Product Line" value={ruleForm.productLine} onChange={(value) => setRuleForm({ ...ruleForm, productLine: value })} />
          <div className="form-row">
            <TextField label="Biller" value={ruleForm.biller} onChange={(value) => setRuleForm({ ...ruleForm, biller: value })} />
            <TextField label="Biller Category" value={ruleForm.billerCategory} onChange={(value) => setRuleForm({ ...ruleForm, billerCategory: value })} />
          </div>
          <TextField label="Transaction Type Filter" value={ruleForm.transactionType} onChange={(value) => setRuleForm({ ...ruleForm, transactionType: value })} />
        </div>

        <div className="drawer-section">
          <div className="form-section-label rule-section-label">Account</div>
          <div className="form-field">
            <label>Debit Account</label>
            <select value={ruleForm.debitAccountCode} onChange={(event) => setRuleForm({ ...ruleForm, debitAccountCode: event.target.value })}>
              <option value="">Select account</option>
              {accounts.map((account) => <option key={account.id} value={account.code}>{account.code} - {account.name}</option>)}
            </select>
          </div>

          <div className="form-field">
            <label>Credit Account(s)</label>
            {ruleForm.creditSplits.map((split, index) => (
              <div className="credit-row" key={index}>
                <select value={split.accountCode} onChange={(event) => updateSplit(index, { accountCode: event.target.value })}>
                  <option value="">Credit account</option>
                  {accounts.map((account) => <option key={account.id} value={account.code}>{account.code} - {account.name}</option>)}
                </select>
                <div className="percent-input">
                  <input
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={split.percentageBps / 100}
                    onChange={(event) => updateSplit(index, { percentageBps: Math.round(Number(event.target.value) * 100) })}
                    aria-label="Credit split percentage"
                  />
                  <span>%</span>
                </div>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeSplit(index)} disabled={ruleForm.creditSplits.length === 1}>Remove</button>
              </div>
            ))}
            <button
              className="btn btn-secondary btn-sm split-add-button"
              type="button"
              onClick={() => setRuleForm((current) => ({ ...current, creditSplits: [...current.creditSplits, { accountCode: '', percentageBps: 0 }] }))}
            >
              Add split
            </button>
            <div className={`split-total ${creditSplitTotal === 10000 ? 'ok' : 'bad'}`}>
              Total: {formatBps(creditSplitTotal)}
            </div>
          </div>
        </div>
      </div>

      <div className="drawer-footer">
        <button className="btn btn-ghost" type="button" onClick={closeRuleDrawer}>Cancel</button>
        <button className="btn btn-primary" type="submit" disabled={!canSave}>{ruleForm.id ? 'Save Changes' : 'Save Rule'}</button>
      </div>
    </form>
  );
}

function SettingsView(props: {
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  accounts: ChartAccount[];
  coaForm: { code: string; name: string; type: AccountType };
  setCoaForm: (form: { code: string; name: string; type: AccountType }) => void;
  saveCoaAccount: (event: FormEvent) => void;
  error: string;
}) {
  const { settingsTab, setSettingsTab, accounts, coaForm, setCoaForm, saveCoaAccount, error } = props;

  return (
    <section className="screen active">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>System configuration, adapter catalog, and accounting references</p>
        </div>
      </div>
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-sidebar-label">Configuration</div>
          {(['coa', 'schema', 'adapters', 'users', 'system'] as SettingsTab[]).map((tab) => (
            <button key={tab} className={`settings-nav-btn${settingsTab === tab ? ' active' : ''}`} onClick={() => setSettingsTab(tab)}>
              {tab === 'coa' ? 'COA Reference' : labelizeTab(tab)}
            </button>
          ))}
        </aside>
        <div className="settings-content">
          {settingsTab === 'coa' ? (
            <div className="settings-panel active">
              <h2>COA Reference</h2>
              <p className="panel-desc">Account codes used in mapping rules.</p>

              <form className="coa-import-strip coa-form" onSubmit={saveCoaAccount}>
                <input className="fi" placeholder="Code" value={coaForm.code} onChange={(event) => setCoaForm({ ...coaForm, code: event.target.value })} />
                <input className="fi" placeholder="Account name" value={coaForm.name} onChange={(event) => setCoaForm({ ...coaForm, name: event.target.value })} />
                <select className="fi" value={coaForm.type} onChange={(event) => setCoaForm({ ...coaForm, type: event.target.value as AccountType })}>
                  <option value="asset">Asset</option>
                  <option value="liability">Liability</option>
                  <option value="equity">Equity</option>
                  <option value="revenue">Revenue</option>
                  <option value="expense">Expense</option>
                </select>
                <button className="btn btn-primary btn-sm" type="submit">Import Account</button>
              </form>
              {error ? <div className="form-error">{error}</div> : null}

              <div className="table-card">
                <table className="tbl">
                  <thead>
                    <tr><th>Code</th><th>Account Name</th><th>Type</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {accounts.map((account) => (
                      <tr key={account.id}>
                        <td className="mono">{account.code}</td>
                        <td>{account.name}</td>
                        <td>{accountTypeChip(account.type)}</td>
                        <td><span className={`badge ${account.active ? 'active-rule' : 'failed'}`}>{account.active ? 'Active' : 'Inactive'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <Placeholder title={labelizeTab(settingsTab)} subtitle="This settings panel will be wired in its corresponding phase." embedded />
          )}
        </div>
      </div>
    </section>
  );
}

function labelizeTab(tab: SettingsTab) {
  return `${tab.charAt(0).toUpperCase()}${tab.slice(1)}`;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function DetailField({
  label,
  value,
  mono = false,
  strong = false
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="df">
      <label>{label}</label>
      <span className={mono ? 'mono' : ''} style={strong ? { fontWeight: 700 } : undefined}>{value}</span>
    </div>
  );
}

function StatCell({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ''}`}>{value}</div>
      <div className={`stat-sub ${tone === 'ok' ? 'ok' : ''}`}>{sub}</div>
    </div>
  );
}

function Placeholder({ title, subtitle, embedded = false }: { title: string; subtitle: string; embedded?: boolean }) {
  return (
    <section className={embedded ? '' : 'screen active'}>
      <div className={embedded ? '' : 'page-header'}>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
    </section>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 2600);
    return () => window.clearTimeout(timeout);
  }, [onClose]);

  return <div id="toast" className="show">{message}</div>;
}

function accountChip(code: string, accounts: ChartAccount[]) {
  const account = accounts.find((item) => item.code === code);
  return <span className={`chip ${accountTypeClass(account?.type)}`}>{code}</span>;
}

function accountTypeChip(type: AccountType) {
  return <span className={`chip ${accountTypeClass(type)}`}>{type}</span>;
}

function accountTypeClass(type?: AccountType) {
  if (type === 'liability') return 'liability';
  if (type === 'expense') return 'expense';
  if (type === 'revenue' || type === 'equity') return 'income';
  return 'asset';
}

function journalSideChips(entry: JournalEntry, side: JournalLine['side'], accounts: ChartAccount[]) {
  const lines = entry.lines.filter((line) => line.side === side);
  if (lines.length === 0) return <span className="dim">-</span>;

  return (
    <div className="chip-stack">
      {lines.map((line) => (
        <span key={`${entry.id}-${side}-${line.line_order}`}>
          {accountChip(line.account_code, accounts)}
          {lines.length > 1 ? (
            <span className="dim" style={{ fontSize: 11 }}> {formatMoney(line.amount, line.currency)}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function formatBps(value: number) {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}

function formatMoney(amount: number, currency: string) {
  return `${currency} ${(amount / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value));
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function postingBadgeClass(status: PostingDisplayStatus) {
  if (status === 'posted') return 'posted';
  if (status === 'failed') return 'failed';
  if (status === 'unmapped') return 'unmapped';
  if (status === 'retry_exhausted') return 'retry-exhausted';
  if (status === 'blocked') return 'test-env';
  return 'pending';
}

function transactionStatusClass(status: TransactionRecord['status']) {
  if (status === 'settled') return 'settled';
  if (status === 'failed') return 'failed';
  if (status === 'reversed') return 'reversed';
  if (status === 'disputed') return 'disputed';
  return 'pending';
}

function transactionJournalStatus(
  transaction: TransactionRecord,
  journalEntries: JournalEntry[]
): PostingDisplayStatus {
  if (transaction.source.environment === 'test') return 'blocked';
  if (transaction.status !== 'settled' && transaction.status !== 'reversed') return 'unposted';

  const journalEntry = journalEntries.find((entry) => entry.transaction_id === transaction.id);
  return journalEntry?.posting_status ?? 'unposted';
}

function transactionWithinDateRange(transaction: TransactionRecord, from: string, to: string) {
  const occurred = transaction.occurred_at.slice(0, 10);
  if (from && occurred < from) return false;
  if (to && occurred > to) return false;
  return true;
}

function formatStatusLabel(status: string) {
  return status.replace('_', ' ');
}

function journalTimeline(entry: JournalEntry) {
  const attempts = entry.attempts.map((attempt) => ({
    ok: ['posted', 'retry_requested', 'queued', 'posting'].includes(attempt.status),
    event:
      attempt.status === 'retry_requested'
        ? `Retry ${attempt.attempt_number} requested via ${attempt.adapter_name}`
        : attempt.status === 'failed'
          ? `Attempt ${attempt.attempt_number} failed${attempt.error_message ? ` - ${attempt.error_message}` : ''}`
          : `Attempt ${attempt.attempt_number} ${attempt.status}`,
    time: attempt.occurred_at
  }));

  return [
    ...attempts,
    {
      ok: entry.posting_status !== 'failed' && entry.posting_status !== 'retry_exhausted',
      event:
        entry.posting_status === 'unmapped'
          ? 'No matching rule - parked in suspense'
          : entry.posting_status === 'posted'
            ? 'Posted to accounting system'
            : 'Journal entry generated',
      time: entry.posted_at ?? entry.generated_at
    },
    {
      ok: true,
      event: entry.mapping_rule_id ? `Mapping rule resolved - ${shortId(entry.mapping_rule_id)}` : 'No mapping rule applied',
      time: entry.generated_at
    }
  ];
}

function exportJournalEntriesCsv(
  entries: JournalEntry[],
  accounts: ChartAccount[],
  filter: JournalEntry['posting_status'] | 'all'
) {
  const headers = [
    'journal_id',
    'transaction_id',
    'source_id',
    'generated_at',
    'transaction_type',
    'product_line',
    'biller',
    'entry_type',
    'posting_status',
    'currency',
    'journal_amount_minor',
    'line_order',
    'line_side',
    'account_code',
    'account_name',
    'line_amount_minor',
    'attempt_count',
    'last_posting_error'
  ];

  const rows = entries.flatMap((entry) =>
    entry.lines.map((line) => {
      const account = accounts.find((item) => item.code === line.account_code);
      return [
        entry.id,
        entry.transaction_id,
        entry.transaction?.source_id ?? '',
        entry.generated_at,
        entry.transaction?.type ?? '',
        entry.transaction?.product_line ?? '',
        entry.transaction?.product_biller ?? '',
        entry.entry_type,
        entry.posting_status,
        entry.currency,
        String(entry.amount),
        String(line.line_order),
        line.side,
        line.account_code,
        account?.name ?? '',
        String(line.amount),
        String(entry.attempt_count),
        entry.last_posting_error ?? ''
      ];
    })
  );

  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `ledgerise-journal-entries-${filter}-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'GET' });
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const payload = await response.json();

  if (!response.ok) {
    const message = Array.isArray(payload.errors)
      ? payload.errors.join(', ')
      : payload.message ?? 'API request failed';
    throw new Error(message);
  }

  return payload as T;
}
