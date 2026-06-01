# Generic Webhook Adapter

Internal MVP inbound adapter for systems that can push JSON payloads to Ledgerise.

The adapter should accept configured field mappings, validate each incoming payload, and emit canonical transaction records.

Required contract methods:

- `meta()`
- `validate(input)`
- `normalize(input)`
- `healthcheck()`

## Input Shape

```ts
{
  payload: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  config: {
    source_system: string;
    environment?: 'live' | 'test';
    field_mappings: Record<string, string>;
    defaults?: Record<string, unknown>;
    metadata_paths?: Record<string, string>;
    amount_multiplier?: number;
  };
}
```

`field_mappings` maps canonical field paths to payload field paths:

```json
{
  "source_id": "transaction.reference",
  "amount": "transaction.amount_kobo",
  "product.line": "product.line"
}
```

The adapter always sets:

- `id`
- `processed_at`
- `source.adapter`
- `source.system`
- `source.environment`

It validates the normalized record against the canonical transaction schema before returning it.
