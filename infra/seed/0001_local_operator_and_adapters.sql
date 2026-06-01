-- Local development seed data for the MVP adapter catalog.

INSERT INTO operators (name, slug)
VALUES ('Local Operator', 'local-operator')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO adapters (
  operator_id,
  name,
  direction,
  runtime,
  version,
  enabled,
  metadata
)
SELECT
  operators.id,
  adapter.name,
  adapter.direction,
  adapter.runtime,
  adapter.version,
  true,
  adapter.metadata::jsonb
FROM operators
CROSS JOIN (
  VALUES
    (
      'generic-webhook',
      'inbound',
      'internal',
      '0.1.0',
      '{"source_system":"generic","modes":["webhook"],"currency_codes":["NGN","KES","GHS","USD"]}'
    ),
    (
      'generic-csv',
      'inbound',
      'internal',
      '0.1.0',
      '{"source_system":"generic","modes":["file-import"],"currency_codes":["NGN","KES","GHS","USD"]}'
    ),
    (
      'generic-poll',
      'inbound',
      'internal',
      '0.1.0',
      '{"source_system":"generic","modes":["poll"],"currency_codes":["NGN","KES","GHS","USD"]}'
    ),
    (
      'generic-journal-csv',
      'outbound',
      'internal',
      '0.1.0',
      '{"target_system":"generic","modes":["file-export"],"currency_codes":["NGN","KES","GHS","USD"]}'
    ),
    (
      'zoho-books',
      'outbound',
      'internal',
      '0.1.0',
      '{"target_system":"zoho-books","modes":["api"],"currency_codes":["NGN","KES","GHS","USD"]}'
    )
) AS adapter(name, direction, runtime, version, metadata)
WHERE operators.slug = 'local-operator'
ON CONFLICT (operator_id, name) DO UPDATE SET
  direction = EXCLUDED.direction,
  runtime = EXCLUDED.runtime,
  version = EXCLUDED.version,
  metadata = EXCLUDED.metadata,
  updated_at = now();
