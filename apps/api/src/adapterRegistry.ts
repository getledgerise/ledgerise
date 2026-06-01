import genericCsv from '../../../adapters/inbound/generic-csv/adapter.json' with { type: 'json' };
import genericPoll from '../../../adapters/inbound/generic-poll/adapter.json' with { type: 'json' };
import genericWebhook from '../../../adapters/inbound/generic-webhook/adapter.json' with { type: 'json' };
import genericJournalCsv from '../../../adapters/outbound/generic-journal-csv/adapter.json' with { type: 'json' };
import zohoBooks from '../../../adapters/outbound/zoho-books/adapter.json' with { type: 'json' };

export type AdapterDirection = 'inbound' | 'outbound';
export type AdapterRuntimeType = 'internal' | 'http';

export interface AdapterRegistryEntry {
  name: string;
  version: string;
  direction: AdapterDirection;
  source_system?: string;
  target_system?: string;
  modes: string[];
  currency_codes: string[];
  runtime: {
    type: AdapterRuntimeType;
  };
}

export const adapterRegistry = [
  genericWebhook as AdapterRegistryEntry,
  genericCsv as AdapterRegistryEntry,
  genericPoll as AdapterRegistryEntry,
  genericJournalCsv as AdapterRegistryEntry,
  zohoBooks as AdapterRegistryEntry
] satisfies AdapterRegistryEntry[];

export function listAdapters(): AdapterRegistryEntry[] {
  return [...adapterRegistry].sort((left, right) => left.name.localeCompare(right.name));
}

export function findAdapter(name: string): AdapterRegistryEntry | undefined {
  return adapterRegistry.find((adapter) => adapter.name === name);
}
