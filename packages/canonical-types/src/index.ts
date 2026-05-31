export type TransactionStatus = 'pending' | 'settled' | 'failed' | 'reversed' | 'disputed';
export type TransactionDirection = 'debit' | 'credit';

export interface CanonicalTransaction {
  id: string;
  source_id?: string;
  source: {
    adapter: string;
    system: string;
    environment?: 'live' | 'test';
  };
  occurred_at: string;
  settled_at: string | null;
  processed_at?: string | null;
  status: TransactionStatus;
  type: string;
  direction: TransactionDirection;
  amount: number;
  currency: string;
  principal: {
    id: string;
    type?: 'customer' | 'merchant' | 'agent' | 'internal';
    reference?: string;
  };
  channel: string;
  product: {
    line: string;
    biller?: string;
    biller_category?: string;
  };
  metadata: Record<string, unknown>;
}
