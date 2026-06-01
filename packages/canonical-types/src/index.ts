export type TransactionStatus = 'pending' | 'settled' | 'failed' | 'reversed' | 'disputed';
export type TransactionDirection = 'debit' | 'credit';
export type TransactionEnvironment = 'live' | 'test';
export type PrincipalType = 'customer' | 'merchant' | 'agent' | 'internal';
export type TransactionChannel =
  | 'web'
  | 'mobile'
  | 'ussd'
  | 'pos'
  | 'api'
  | 'agent'
  | 'qr'
  | 'nfc'
  | 'internal';

export type StandardTransactionType =
  | 'payment.airtime'
  | 'payment.data'
  | 'payment.electricity'
  | 'payment.water'
  | 'payment.cable-tv'
  | 'payment.internet'
  | 'payment.insurance-premium'
  | 'payment.government-levy'
  | 'payment.education'
  | 'payment.transport'
  | 'payment.betting'
  | 'payment.merchant'
  | 'payment.invoice'
  | 'payment.subscription'
  | 'transfer.wallet-to-wallet'
  | 'transfer.wallet-to-bank'
  | 'transfer.bank-to-wallet'
  | 'transfer.agent-to-wallet'
  | 'transfer.wallet-to-agent'
  | 'transfer.internal'
  | 'collection.pos'
  | 'collection.web'
  | 'collection.mobile'
  | 'collection.ussd'
  | 'collection.qr'
  | 'collection.nfc'
  | 'collection.api'
  | 'collection.agent'
  | 'collection.bank-transfer'
  | 'collection.direct-debit'
  | 'fee.platform'
  | 'fee.processing'
  | 'fee.withdrawal'
  | 'fee.maintenance'
  | 'fee.card'
  | 'fee.fx'
  | 'fee.late-payment'
  | 'fee.reversal'
  | 'fee.chargeback'
  | 'loan.disbursement'
  | 'loan.repayment.principal'
  | 'loan.repayment.interest'
  | 'loan.repayment.penalty'
  | 'loan.repayment.fee'
  | 'loan.write-off'
  | 'loan.provision'
  | 'loan.restructure'
  | 'savings.deposit'
  | 'savings.withdrawal'
  | 'savings.interest-credit'
  | 'savings.liquidation'
  | 'investment.purchase'
  | 'investment.maturity'
  | 'investment.yield-payout'
  | 'investment.liquidation'
  | 'remittance.send'
  | 'remittance.receive'
  | 'remittance.fee'
  | 'fx.conversion'
  | 'fx.fee'
  | 'fx.gain'
  | 'fx.loss'
  | 'card.load'
  | 'card.spend'
  | 'card.reversal'
  | 'card.chargeback'
  | 'card.chargeback-reversal'
  | 'card.fee'
  | 'card.expiry-credit'
  | 'agency.cash-in'
  | 'agency.cash-out'
  | 'agency.commission'
  | 'agency.vault-deposit'
  | 'agency.vault-withdrawal'
  | 'agency.float-allocation'
  | 'agency.float-recovery'
  | 'system.reversal'
  | 'system.refund'
  | 'system.adjustment'
  | 'system.settlement-batch'
  | 'system.suspense-debit'
  | 'system.suspense-credit'
  | 'system.opening-balance'
  | 'system.closing-balance';

export type TransactionType = StandardTransactionType | (string & {});

export interface TransactionSource {
  adapter: string;
  system: string;
  environment?: TransactionEnvironment;
}

export interface TransactionFee {
  platform_fee?: number;
  processing_fee?: number;
  net_fee?: number;
}

export interface TransactionPrincipal {
  id: string;
  type?: PrincipalType;
  reference?: string;
}

export interface TransactionProduct {
  line: string;
  biller?: string;
  biller_category?: string;
}

export interface TransactionFloat {
  aggregator?: string;
  account_ref?: string;
  balance_before?: number | null;
  balance_after?: number | null;
}

export interface CanonicalTransaction {
  id: string;
  source_id?: string;
  source: TransactionSource;
  occurred_at: string;
  settled_at: string | null;
  processed_at?: string | null;
  status: TransactionStatus;
  type: TransactionType;
  direction: TransactionDirection;
  amount: number;
  currency: string;
  fee?: TransactionFee;
  principal: TransactionPrincipal;
  channel: TransactionChannel;
  product: TransactionProduct;
  float?: TransactionFloat;
  reversal_of?: string | null;
  metadata: Record<string, unknown>;
}
