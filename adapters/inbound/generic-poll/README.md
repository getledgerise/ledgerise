# Generic Poll Adapter

Internal MVP inbound adapter for simple JSON APIs that Ledgerise fetches on a schedule.

The adapter should support configured URL, auth, records path, pagination, cursor fields, and canonical field mappings. Keep this adapter intentionally modest; complex provider behavior should move into dedicated external adapters.

Required contract methods:

- `meta()`
- `validate(input)`
- `normalize(input)`
- `healthcheck()`

## Input Shape

```ts
{
  cursor?: {
    last_fetched_at?: string;
    last_source_id?: string;
  };
  config: {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    records_path: string;
    source_system: string;
    environment?: 'live' | 'test';
    field_mappings: Record<string, string>;
    defaults?: Record<string, unknown>;
    metadata_paths?: Record<string, string>;
    cursor_query_param?: string;
    cursor_response_path?: string;
    next_cursor_record_path?: string;
    amount_multiplier?: number;
  };
}
```

`records_path` points to the array of source records in the JSON response. `field_mappings` maps canonical field paths to paths inside each source record.

Cursor behavior:

- `cursor_query_param` sends the current cursor value as a URL query parameter.
- `cursor_response_path` reads the next cursor from the response body.
- `next_cursor_record_path` can derive the next cursor from the final source record when the response body has no cursor object.
