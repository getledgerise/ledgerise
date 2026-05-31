export type AdapterDirection = 'inbound' | 'outbound';
export type AdapterRuntime = 'internal' | 'http';

export interface AdapterMeta {
  name: string;
  version: string;
  direction: AdapterDirection;
  modes: string[];
  currency_codes: string[];
  runtime: {
    type: AdapterRuntime;
  };
}

export interface AdapterError {
  status: 'error';
  code: string;
  message: string;
  raw?: unknown;
}
