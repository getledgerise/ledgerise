# Zoho Books Adapter

Internal MVP outbound adapter for posting journal entries to Zoho Books.

Zoho-specific OAuth, account IDs, journal payloads, and API errors must stay inside this adapter.

Required contract methods:

- `meta()`
- `validate(input)`
- `postJournals(input)`
- `healthcheck()`
