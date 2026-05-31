# Ledgerise API

Core HTTP API for Ledgerise.

Responsibilities:

- Authentication and authorization
- Canonical transaction ingestion
- Schema validation
- Mapping rule management
- Journal log reads and manual retries
- Adapter registration/configuration
- COA import and reads
- Audit event access

Adapter-specific parsing and posting logic must stay outside the API core.
