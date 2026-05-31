# Generic Webhook Adapter

Internal MVP inbound adapter for systems that can push JSON payloads to Ledgerise.

The adapter should accept configured field mappings, validate each incoming payload, and emit canonical transaction records.

Required contract methods:

- `meta()`
- `validate(input)`
- `normalize(input)`
- `healthcheck()`
