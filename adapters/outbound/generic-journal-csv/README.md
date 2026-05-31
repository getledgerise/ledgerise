# Generic Journal CSV Adapter

Internal MVP outbound adapter for exporting generated journal entries as CSV.

This is the portable fallback when no accounting API is configured.

Required contract methods:

- `meta()`
- `validate(input)`
- `postJournals(input)`
- `healthcheck()`
