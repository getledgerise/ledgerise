import type { GenericWebhookConfig } from '../src/index.js';

export const validBillPaymentPayload = {
  transaction: {
    reference: 'GW-20260601-0001',
    happened_at: '2026-06-01T08:14:22Z',
    settled_at: '2026-06-01T08:14:35Z',
    status: 'settled',
    type: 'payment.electricity',
    direction: 'debit',
    amount_kobo: 500000,
    currency: 'NGN',
    channel: 'mobile'
  },
  customer: {
    id: 'usr_0000291',
    type: 'customer',
    masked_phone: '080****4421'
  },
  product: {
    line: 'consumer-app',
    biller: 'ikeja-electric',
    biller_category: 'electricity'
  },
  fee: {
    platform_fee: 10000,
    processing_fee: 5000,
    net_fee: 5000
  },
  source: {
    token: '45120093847162903847'
  }
};

export const validBillPaymentConfig: GenericWebhookConfig = {
  source_system: 'airvend-core',
  environment: 'live',
  field_mappings: {
    source_id: 'transaction.reference',
    occurred_at: 'transaction.happened_at',
    settled_at: 'transaction.settled_at',
    status: 'transaction.status',
    type: 'transaction.type',
    direction: 'transaction.direction',
    amount: 'transaction.amount_kobo',
    currency: 'transaction.currency',
    channel: 'transaction.channel',
    'principal.id': 'customer.id',
    'principal.type': 'customer.type',
    'principal.reference': 'customer.masked_phone',
    'product.line': 'product.line',
    'product.biller': 'product.biller',
    'product.biller_category': 'product.biller_category',
    'fee.platform_fee': 'fee.platform_fee',
    'fee.processing_fee': 'fee.processing_fee',
    'fee.net_fee': 'fee.net_fee'
  },
  metadata_paths: {
    token: 'source.token'
  }
};

export const expectedCanonicalFields = {
  source_id: 'GW-20260601-0001',
  source: {
    adapter: 'generic-webhook',
    system: 'airvend-core',
    environment: 'live'
  },
  status: 'settled',
  type: 'payment.electricity',
  direction: 'debit',
  amount: 500000,
  currency: 'NGN',
  channel: 'mobile',
  product: {
    line: 'consumer-app',
    biller: 'ikeja-electric',
    biller_category: 'electricity'
  }
};
