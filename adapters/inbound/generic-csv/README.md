# Generic CSV Adapter

Internal MVP inbound adapter for CSV/XLSX imports, onboarding backfills, and operators without API access.

The adapter should support configurable column mappings, row-level validation, and partial success reporting.

Required contract methods:

- `meta()`
- `validate(input)`
- `normalize(input)`
- `healthcheck()`
