# Generic Poll Adapter

Internal MVP inbound adapter for simple JSON APIs that Ledgerise fetches on a schedule.

The adapter should support configured URL, auth, records path, pagination, cursor fields, and canonical field mappings. Keep this adapter intentionally modest; complex provider behavior should move into dedicated external adapters.

Required contract methods:

- `meta()`
- `validate(input)`
- `normalize(input)`
- `healthcheck()`
