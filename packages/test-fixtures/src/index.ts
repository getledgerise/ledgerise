import type { CanonicalTransaction } from '@ledgerise/canonical-types';

export const settledBillPayment: CanonicalTransaction = {
  id: 'a3f1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d',
  source_id: 'TXN-20260530-00419',
  source: {
    adapter: 'generic-webhook',
    system: 'airvend-core',
    environment: 'live'
  },
  occurred_at: '2026-05-30T08:14:22Z',
  settled_at: '2026-05-30T08:14:35Z',
  processed_at: '2026-05-30T08:15:00Z',
  status: 'settled',
  type: 'payment.electricity',
  direction: 'debit',
  amount: 500000,
  currency: 'NGN',
  fee: {
    platform_fee: 10000,
    processing_fee: 5000,
    net_fee: 5000
  },
  principal: {
    id: 'usr_0000291',
    type: 'customer',
    reference: '080****4421'
  },
  channel: 'mobile',
  product: {
    line: 'consumer-app',
    biller: 'ikeja-electric',
    biller_category: 'electricity'
  },
  float: {
    aggregator: 'buypower',
    account_ref: 'AV-BP-001',
    balance_before: 12000000,
    balance_after: 11500000
  },
  reversal_of: null,
  metadata: {
    token: '45120093847162903847',
    meter_number: '0410****2291',
    narration: 'IKEJA ELECTRIC 500 UNITS'
  }
};

export const pendingTransaction: CanonicalTransaction = {
  ...settledBillPayment,
  id: 'a3f1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6e',
  source_id: 'TXN-20260530-00420',
  settled_at: null,
  status: 'pending'
};

export const failedTransaction: CanonicalTransaction = {
  ...settledBillPayment,
  id: 'a3f1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6f',
  source_id: 'TXN-20260530-00421',
  settled_at: null,
  status: 'failed'
};

export const testEnvironmentTransaction: CanonicalTransaction = {
  ...settledBillPayment,
  id: 'a3f1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c70',
  source_id: 'TXN-20260530-00422',
  source: {
    ...settledBillPayment.source,
    environment: 'test'
  }
};

export const reversedTransaction: CanonicalTransaction = {
  ...settledBillPayment,
  id: 'a3f1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c71',
  source_id: 'TXN-20260530-00423',
  status: 'reversed',
  type: 'system.reversal',
  direction: 'credit',
  reversal_of: settledBillPayment.id
};

export const unmappedCustomTransaction: CanonicalTransaction = {
  ...settledBillPayment,
  id: 'a3f1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c72',
  source_id: 'TXN-20260530-00424',
  type: 'payment.toll',
  product: {
    line: 'new-product-line',
    biller: 'lagos-toll',
    biller_category: 'transport'
  }
};

export const feeSplitTransaction: CanonicalTransaction = {
  ...settledBillPayment,
  id: 'a3f1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c73',
  source_id: 'TXN-20260530-00425',
  type: 'fee.platform',
  amount: 15000,
  fee: {
    platform_fee: 15000,
    processing_fee: 2500,
    net_fee: 12500
  }
};

export const validCanonicalTransactions = [
  settledBillPayment,
  pendingTransaction,
  failedTransaction,
  testEnvironmentTransaction,
  reversedTransaction,
  unmappedCustomTransaction,
  feeSplitTransaction
] satisfies CanonicalTransaction[];

export const invalidCanonicalTransactions = {
  missingRequiredField: {
    ...settledBillPayment,
    principal: {}
  },
  invalidStatus: {
    ...settledBillPayment,
    status: 'complete'
  },
  invalidCustomTypePattern: {
    ...settledBillPayment,
    type: 'Payment Toll'
  },
  additionalTopLevelProperty: {
    ...settledBillPayment,
    raw_payload: {}
  }
} satisfies Record<string, unknown>;

export const csvRowWithValidationError = {
  source_id: 'CSV-ROW-001',
  occurred_at: '2026-05-30T08:14:22Z',
  settled_at: '',
  status: 'complete',
  type: 'payment.electricity',
  direction: 'debit',
  amount: '-500000',
  currency: 'ngn'
};

export const pollResponseWithCursor = {
  records: [settledBillPayment],
  next_cursor: '2026-05-30T08:15:00Z'
};
