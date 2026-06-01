# Generic CSV Adapter

Internal MVP inbound adapter for CSV/XLSX imports, onboarding backfills, and operators without API access.

The adapter should support configurable column mappings, row-level validation, and partial success reporting.

Required contract methods:

- `meta()`
- `validate(input)`
- `normalize(input)`
- `healthcheck()`

## Input Shape

```ts
{
  content: string;
  filename?: string;
  config: {
    source_system: string;
    environment?: 'live' | 'test';
    column_mappings: Record<string, string>;
    defaults?: Record<string, unknown>;
    metadata_columns?: Record<string, string>;
    delimiter?: string;
    amount_multiplier?: number;
  };
}
```

`column_mappings` maps canonical field paths to CSV header names:

```json
{
  "source_id": "reference",
  "amount": "amount",
  "product.line": "product_line"
}
```

The adapter returns valid records in `records`. Invalid rows are reported in `row_errors` on the success envelope when at least one row is valid. If no row is valid, the adapter returns `VALIDATION_FAILED`.
