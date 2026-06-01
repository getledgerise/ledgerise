import type { GenericCsvConfig } from '../src/index.js';

export const mixedBillPaymentsCsv = `reference,occurred_at,settled_at,status,type,direction,amount,currency,channel,principal_id,principal_type,principal_reference,product_line,biller,biller_category,token
CSV-20260601-0001,2026-06-01T08:14:22Z,2026-06-01T08:14:35Z,settled,payment.electricity,debit,500000,NGN,mobile,usr_0000291,customer,080****4421,consumer-app,ikeja-electric,electricity,45120093847162903847
CSV-20260601-0002,2026-06-01T08:16:22Z,2026-06-01T08:16:35Z,settled,payment.airtime,debit,100000,NGN,mobile,usr_0000292,customer,080****4433,consumer-app,mtn,airtime,45120093847162903848
CSV-20260601-0003,2026-06-01T08:18:22Z,2026-06-01T08:18:35Z,complete,payment.airtime,debit,100000,NGN,mobile,usr_0000293,customer,080****4444,consumer-app,mtn,airtime,45120093847162903849
`;

export const mixedBillPaymentsConfig: GenericCsvConfig = {
  source_system: 'csv-backfill',
  environment: 'live',
  column_mappings: {
    source_id: 'reference',
    occurred_at: 'occurred_at',
    settled_at: 'settled_at',
    status: 'status',
    type: 'type',
    direction: 'direction',
    amount: 'amount',
    currency: 'currency',
    channel: 'channel',
    'principal.id': 'principal_id',
    'principal.type': 'principal_type',
    'principal.reference': 'principal_reference',
    'product.line': 'product_line',
    'product.biller': 'biller',
    'product.biller_category': 'biller_category'
  },
  metadata_columns: {
    token: 'token'
  }
};

export const expectedMixedBillPaymentSummary = {
  valid_records: 2,
  row_errors: 1,
  first_source_id: 'CSV-20260601-0001',
  bad_row: 4
};
