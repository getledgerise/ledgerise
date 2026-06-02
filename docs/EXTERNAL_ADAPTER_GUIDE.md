# External Adapter Contributor Guide

This guide covers how to build a provider-specific inbound adapter for Ledgerise. After reading it you will be able to contribute a new adapter that connects a payment platform to Ledgerise without touching `core/engine` or any existing adapter.

Read [`ADAPTER_SPEC.md`](ADAPTER_SPEC.md) for the authoritative interface contract before continuing. Read [`schemas/transaction.schema.json`](../schemas/transaction.schema.json) for the full canonical transaction schema.

---

## What You Are Building

An inbound adapter is a TypeScript module that knows how to speak to one source system and translate that system's transaction data into Ledgerise canonical transactions. The adapter is called by the API or worker; it hands back an envelope of canonical records. Everything downstream — mapping, journals, posting — never sees provider data. Only canonical records cross that boundary.

The adapter must not contain journal logic, COA references, or any accounting rules. Those belong in the core engine.

---

## Adapter Modes

Choose the mode that matches how your source system delivers data.

| Mode | When to use |
|---|---|
| **Webhook** | The source system pushes individual events to a URL you expose. One event yields one canonical record. |
| **Poll** | Your adapter is called on a schedule and fetches a batch of records from the source API using a cursor to resume from the last successful run. |
| **File import** | An operator uploads a flat file (CSV, XLSX). Your adapter parses each row and emits a list of canonical records. |

If a source supports both webhook and poll, build two separate named adapters rather than one that handles both modes. Keep each adapter simple and independently testable.

---

## Repository Layout

Place your adapter under `adapters/inbound/{source-system}-{mode}/`:

```
adapters/inbound/paystack-webhook/
├── adapter.json          # Static metadata read at registration
├── src/
│   └── index.ts          # Adapter module (exports meta, validate, normalize, healthcheck)
├── fixtures/
│   └── settled-payment.ts  # Realistic payload + expected canonical fields
├── tests/
│   └── index.test.ts     # Unit tests (see Testing section)
├── package.json
└── tsconfig.json
```

---

## `adapter.json`

Every adapter declares its static metadata in `adapter.json`. Ledgerise reads this at registration time.

```json
{
  "name": "paystack-webhook",
  "version": "1.0.0",
  "direction": "inbound",
  "source_system": "paystack",
  "modes": ["webhook"],
  "currency_codes": ["NGN", "GHS", "KES", "ZAR", "USD"],
  "runtime": {
    "type": "internal"
  }
}
```

| Field | Required | Rules |
|---|---|---|
| `name` | Yes | Unique kebab-case identifier across all registered adapters. Pattern: `{source-system}-{mode}`. |
| `version` | Yes | Semantic version string. |
| `direction` | Yes | `"inbound"` for all adapters in `adapters/inbound/`. |
| `source_system` | Yes | The upstream platform. Lowercase, no spaces. |
| `modes` | Yes | Array of supported modes. At least one required. |
| `currency_codes` | Yes | ISO 4217 codes this adapter can produce. |
| `runtime.type` | Yes | `"internal"` for adapters bundled into the monorepo. `"http"` for adapters running as a separate service (see HTTP Runtime section). |

---

## The Adapter Interface

Your `src/index.ts` must export these four functions. The types come from `@ledgerise/adapter-sdk`.

```ts
import type {
  AdapterMeta,
  AdapterValidationResult,
  AdapterResult,
  AdapterHealthcheckResult,
} from '@ledgerise/adapter-sdk';
import type { CanonicalTransaction } from '@ledgerise/canonical-types';

export function meta(): AdapterMeta;
export function validate(input: YourInputType): AdapterValidationResult;
export async function normalize(input: YourInputType): Promise<AdapterResult<CanonicalTransaction>>;
export async function healthcheck(): Promise<AdapterHealthcheckResult>;
```

All four must be present even if a mode does not use one of them. Return a `METHOD_NOT_SUPPORTED` error for methods that do not apply.

---

## Example: Inbound Webhook Adapter

This example implements a Paystack webhook adapter. The source system posts JSON events to your endpoint. Your adapter receives the parsed body plus request headers, validates them, and returns canonical records.

### `adapter.json`

```json
{
  "name": "paystack-webhook",
  "version": "1.0.0",
  "direction": "inbound",
  "source_system": "paystack",
  "modes": ["webhook"],
  "currency_codes": ["NGN", "GHS", "KES", "ZAR"],
  "runtime": {
    "type": "internal"
  }
}
```

### `src/index.ts`

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import {
  adapterError,
  ok,
  validationFailed,
  type AdapterHealthcheckResult,
  type AdapterMeta,
  type AdapterResult,
  type AdapterValidationResult,
} from '@ledgerise/adapter-sdk';
import type { CanonicalTransaction } from '@ledgerise/canonical-types';
import { validateCanonicalTransaction } from '@ledgerise/core-schema';

import adapter from '../adapter.json' with { type: 'json' };

// Config is injected by the operator through the Ledgerise settings UI or environment.
export interface PaystackWebhookConfig {
  webhookSecret: string;   // Used to verify the X-Paystack-Signature header.
  environment: 'live' | 'test';
  productLine: string;
}

export interface PaystackWebhookInput {
  payload: unknown;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;         // Original request body bytes before JSON parsing, used for HMAC verification.
  config: PaystackWebhookConfig;
}

export function meta(): AdapterMeta {
  return adapter as AdapterMeta;
}

export function validate(input: PaystackWebhookInput): AdapterValidationResult {
  const errors = [];

  if (!isRecord(input.payload)) {
    return { valid: false, errors: [{ field: 'payload', message: 'Payload must be a JSON object', raw_value: input.payload }] };
  }

  if (!isRecord(input.config)) {
    return { valid: false, errors: [{ field: 'config', message: 'Config must be an object' }] };
  }

  if (!input.config.webhookSecret) {
    errors.push({ field: 'config.webhookSecret', message: 'webhookSecret is required' });
  }

  if (!input.config.productLine) {
    errors.push({ field: 'config.productLine', message: 'productLine is required' });
  }

  // Verify Paystack signature before any normalization.
  if (input.config.webhookSecret && input.rawBody) {
    const signature = String(input.headers['x-paystack-signature'] ?? '');
    if (!verifyHmac(input.rawBody, input.config.webhookSecret, signature)) {
      errors.push({ field: 'headers.x-paystack-signature', message: 'Signature verification failed' });
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function normalize(
  input: PaystackWebhookInput
): Promise<AdapterResult<CanonicalTransaction>> {
  const validation = validate(input);
  if (!validation.valid) {
    return validationFailed('Paystack webhook input failed validation', validation.errors, input.payload);
  }

  try {
    const event = input.payload as Record<string, unknown>;
    const eventType = String(event['event'] ?? '');

    // Only handle charge events. Return a structured error for unknown event types.
    if (!eventType.startsWith('charge.')) {
      return adapterError('UNSUPPORTED_EVENT', `Unsupported Paystack event: ${eventType}`, event);
    }

    const data = event['data'];
    if (!isRecord(data)) {
      return adapterError('MALFORMED_PAYLOAD', 'Paystack event.data is missing or not an object', event);
    }

    const record = buildCanonicalRecord(data, input.config);
    const outputValidation = validateCanonicalTransaction(record);

    if (!outputValidation.valid) {
      return validationFailed(
        'Paystack webhook mapping did not produce a valid canonical transaction',
        outputValidation.errors.map((e) => ({ field: e.fieldPath, message: e.message, raw_value: e.rawValue })),
        data
      );
    }

    return ok([record]);
  } catch (error) {
    return adapterError(
      'ADAPTER_NORMALIZATION_FAILED',
      error instanceof Error ? error.message : 'Paystack webhook normalization failed',
      input.payload
    );
  }
}

export async function healthcheck(): Promise<AdapterHealthcheckResult> {
  // Webhook adapters are passive — the source pushes to us.
  // A real implementation could call GET /transaction?perPage=1 to confirm credentials.
  return { status: 'ok', latency_ms: 0, checked_at: new Date().toISOString() };
}

// --- Internal helpers ---

function buildCanonicalRecord(
  data: Record<string, unknown>,
  config: PaystackWebhookConfig
): CanonicalTransaction {
  const amountKobo = Number(data['amount'] ?? 0);  // Paystack amounts are in kobo already.

  return {
    id: randomUUID(),
    source_id: String(data['reference'] ?? ''),
    source: {
      adapter: meta().name,
      system: 'paystack',
      environment: config.environment,
    },
    occurred_at: String(data['created_at'] ?? new Date().toISOString()),
    settled_at: String(data['paid_at'] ?? null),
    processed_at: new Date().toISOString(),
    status: mapStatus(String(data['status'] ?? '')),
    type: 'collection.web',
    direction: 'credit',
    amount: amountKobo,
    currency: String(data['currency'] ?? 'NGN'),
    channel: mapChannel(String(data['channel'] ?? '')),
    principal: {
      id: String((data['customer'] as Record<string, unknown>)?.['id'] ?? ''),
      type: 'customer',
    },
    product: {
      line: config.productLine,
    },
    metadata: {
      paystack_reference: data['reference'],
      paystack_gateway_response: data['gateway_response'],
    },
  } as unknown as CanonicalTransaction;
}

function mapStatus(paystackStatus: string): 'settled' | 'failed' | 'pending' {
  if (paystackStatus === 'success') return 'settled';
  if (paystackStatus === 'failed') return 'failed';
  return 'pending';
}

function mapChannel(paystackChannel: string): CanonicalTransaction['channel'] {
  const channelMap: Record<string, CanonicalTransaction['channel']> = {
    card: 'web',
    bank: 'web',
    ussd: 'ussd',
    mobile_money: 'mobile',
    qr: 'qr',
  };
  return channelMap[paystackChannel] ?? 'api';
}

function verifyHmac(rawBody: string, secret: string, signature: string): boolean {
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
```

### `fixtures/settled-payment.ts`

```ts
import type { PaystackWebhookConfig, PaystackWebhookInput } from '../src/index.js';

// Realistic Paystack charge.success event (anonymized).
export const settledPaymentPayload = {
  event: 'charge.success',
  data: {
    reference: 'PSK-20260601-0001',
    status: 'success',
    amount: 500000,         // 5,000 NGN in kobo
    currency: 'NGN',
    channel: 'card',
    paid_at: '2026-06-01T08:14:35Z',
    created_at: '2026-06-01T08:14:22Z',
    gateway_response: 'Approved',
    customer: {
      id: 'CUS_0000291',
      email: 'user@example.com',
    },
  },
};

export const config: PaystackWebhookConfig = {
  webhookSecret: 'test_secret',
  environment: 'live',
  productLine: 'consumer-app',
};

export const expectedCanonicalFields = {
  source_id: 'PSK-20260601-0001',
  source: { adapter: 'paystack-webhook', system: 'paystack', environment: 'live' },
  status: 'settled',
  direction: 'credit',
  amount: 500000,
  currency: 'NGN',
};
```

---

## Example: Inbound Poll Adapter

This example implements an adapter that polls a provider's REST API on a schedule, resuming from a cursor returned by the previous run. The worker calls `normalize` with the saved cursor; the adapter fetches records, maps them, and returns the next cursor along with the canonical records.

### `adapter.json`

```json
{
  "name": "acme-pay-poll",
  "version": "1.0.0",
  "direction": "inbound",
  "source_system": "acme-pay",
  "modes": ["poll"],
  "currency_codes": ["NGN", "USD"],
  "runtime": {
    "type": "internal"
  }
}
```

### `src/index.ts`

```ts
import { randomUUID } from 'node:crypto';

import {
  adapterError,
  ok,
  validationFailed,
  type AdapterHealthcheckResult,
  type AdapterMeta,
  type AdapterResult,
  type AdapterValidationResult,
} from '@ledgerise/adapter-sdk';
import type { CanonicalTransaction } from '@ledgerise/canonical-types';
import { validateCanonicalTransaction } from '@ledgerise/core-schema';

import adapter from '../adapter.json' with { type: 'json' };

// Cursor persisted between runs by the Ledgerise poll runner.
export interface AcmePayCursor {
  after_id?: string;      // ID of the last record successfully processed.
  after_timestamp?: string; // ISO 8601 timestamp of the last record.
}

export interface AcmePayConfig {
  apiKey: string;
  baseUrl: string;        // e.g. https://api.acmepay.io/v1
  environment: 'live' | 'test';
  productLine: string;
  pageSize?: number;      // Defaults to 100.
}

export interface AcmePayPollInput {
  cursor?: AcmePayCursor;
  config: AcmePayConfig;
}

export function meta(): AdapterMeta {
  return adapter as AdapterMeta;
}

export function validate(input: AcmePayPollInput): AdapterValidationResult {
  const errors = [];

  if (!isRecord(input.config)) {
    return { valid: false, errors: [{ field: 'config', message: 'Config must be an object' }] };
  }

  if (!input.config.apiKey) {
    errors.push({ field: 'config.apiKey', message: 'apiKey is required' });
  }

  if (!input.config.baseUrl) {
    errors.push({ field: 'config.baseUrl', message: 'baseUrl is required' });
  }

  if (!input.config.productLine) {
    errors.push({ field: 'config.productLine', message: 'productLine is required' });
  }

  return { valid: errors.length === 0, errors };
}

export async function normalize(
  input: AcmePayPollInput
): Promise<AdapterResult<CanonicalTransaction, AcmePayCursor>> {
  const validation = validate(input);
  if (!validation.valid) {
    return validationFailed('Acme Pay poll input failed validation', validation.errors, input);
  }

  try {
    const rawRecords = await fetchAllPages(input);
    const records: CanonicalTransaction[] = [];
    const rowErrors = [];

    for (const [index, raw] of rawRecords.entries()) {
      const record = buildCanonicalRecord(raw, input.config);
      const result = validateCanonicalTransaction(record);

      if (!result.valid) {
        rowErrors.push({
          row: index,
          raw,
          errors: result.errors.map((e) => ({ field: e.fieldPath, message: e.message, raw_value: e.rawValue })),
        });
        continue;
      }

      records.push(record);
    }

    if (records.length === 0 && rawRecords.length > 0) {
      return validationFailed(
        'No Acme Pay records produced valid canonical transactions',
        rowErrors.flatMap((re) => re.errors.map((e) => ({ ...e, field: `record.${re.row}.${e.field}` }))),
        rawRecords
      );
    }

    const cursor = buildNextCursor(rawRecords, input.cursor);
    return ok(records, cursor, rowErrors);
  } catch (error) {
    if (error instanceof FetchError) {
      return adapterError(error.code, error.message, error.context);
    }
    return adapterError(
      'ADAPTER_NORMALIZATION_FAILED',
      error instanceof Error ? error.message : 'Acme Pay poll normalization failed',
      input.config.baseUrl
    );
  }
}

export async function healthcheck(): Promise<AdapterHealthcheckResult> {
  // Poll adapters must verify connectivity on healthcheck.
  // Use a lightweight endpoint — account info, a single record, or a ping.
  const start = Date.now();

  try {
    const url = `${process.env.ACME_PAY_BASE_URL ?? 'https://api.acmepay.io/v1'}/account`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.ACME_PAY_API_KEY ?? ''}` },
    });

    if (!response.ok) {
      return {
        status: 'error',
        code: response.status === 401 ? 'AUTH_FAILED' : 'SOURCE_UNREACHABLE',
        message: `Acme Pay API returned HTTP ${response.status}`,
        checked_at: new Date().toISOString(),
      };
    }

    return { status: 'ok', latency_ms: Date.now() - start, checked_at: new Date().toISOString() };
  } catch (error) {
    return {
      status: 'error',
      code: 'SOURCE_UNREACHABLE',
      message: error instanceof Error ? error.message : 'Could not reach Acme Pay API',
      checked_at: new Date().toISOString(),
    };
  }
}

// --- Internal helpers ---

async function fetchAllPages(input: AcmePayPollInput): Promise<unknown[]> {
  const pageSize = input.config.pageSize ?? 100;
  const records: unknown[] = [];
  let cursor = input.cursor?.after_id;

  for (let page = 0; page < 20; page++) {  // Hard limit to avoid runaway loops.
    const url = new URL(`${input.config.baseUrl}/transactions`);
    url.searchParams.set('limit', String(pageSize));
    if (cursor) url.searchParams.set('after', cursor);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new FetchError(
        response.status === 401 ? 'AUTH_FAILED' : 'SOURCE_UNREACHABLE',
        `Acme Pay API returned HTTP ${response.status}`,
        { url: url.toString(), status: response.status }
      );
    }

    const body = await response.json() as Record<string, unknown>;
    const page_records = body['transactions'];

    if (!Array.isArray(page_records) || page_records.length === 0) break;

    records.push(...page_records);
    const nextCursor = body['next_cursor'];
    if (!nextCursor) break;
    cursor = String(nextCursor);
  }

  return records;
}

function buildCanonicalRecord(
  raw: unknown,
  config: AcmePayConfig
): CanonicalTransaction {
  const tx = raw as Record<string, unknown>;
  const amountMinorUnits = Number(tx['amount_minor'] ?? 0);

  return {
    id: randomUUID(),
    source_id: String(tx['id'] ?? ''),
    source: {
      adapter: meta().name,
      system: 'acme-pay',
      environment: config.environment,
    },
    occurred_at: String(tx['created_at'] ?? ''),
    settled_at: tx['settled_at'] ? String(tx['settled_at']) : null,
    processed_at: new Date().toISOString(),
    status: mapStatus(String(tx['status'] ?? '')),
    type: String(tx['type'] ?? 'payment.merchant'),
    direction: String(tx['direction'] ?? 'debit') as 'debit' | 'credit',
    amount: amountMinorUnits,
    currency: String(tx['currency'] ?? 'NGN'),
    channel: 'api',
    principal: {
      id: String(tx['customer_id'] ?? ''),
      type: 'customer',
    },
    product: {
      line: config.productLine,
      biller: tx['biller'] ? String(tx['biller']) : undefined,
    },
    metadata: {
      acme_reference: tx['reference'],
    },
  } as unknown as CanonicalTransaction;
}

function mapStatus(raw: string): 'settled' | 'failed' | 'pending' | 'reversed' {
  if (raw === 'completed') return 'settled';
  if (raw === 'failed') return 'failed';
  if (raw === 'reversed') return 'reversed';
  return 'pending';
}

function buildNextCursor(rawRecords: unknown[], previous?: AcmePayCursor): AcmePayCursor {
  const last = rawRecords.at(-1) as Record<string, unknown> | undefined;
  if (!last) return previous ?? {};

  return {
    after_id: String(last['id'] ?? previous?.after_id ?? ''),
    after_timestamp: String(last['created_at'] ?? previous?.after_timestamp ?? ''),
  };
}

class FetchError extends Error {
  constructor(
    public readonly code: 'AUTH_FAILED' | 'SOURCE_UNREACHABLE',
    message: string,
    public readonly context: unknown
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
```

---

## Signature Verification

Webhook adapters must verify that incoming requests genuinely came from the source system. Do this inside `validate()` before any normalization runs. Never skip verification in production, even partially.

The standard pattern is HMAC-SHA256 or HMAC-SHA512 over the raw request body using a shared secret.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyHmac(
  rawBody: string,     // Raw bytes as received — do not parse before hashing.
  secret: string,      // Operator-supplied secret from adapter config.
  signature: string,   // Hex digest from the provider's header.
  algorithm: 'sha256' | 'sha512' = 'sha256'
): boolean {
  const expected = createHmac(algorithm, secret).update(rawBody, 'utf8').digest('hex');

  try {
    // timingSafeEqual prevents timing attacks.
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    // Buffers had different lengths — signature is invalid.
    return false;
  }
}
```

Rules:

1. Hash the raw request body, not the parsed JSON object. Any whitespace change invalidates the signature.
2. Always use `timingSafeEqual` rather than `===` to compare digests.
3. Return a `VALIDATION_FAILED` error from `validate()` if verification fails. Do not proceed to normalization.
4. Never log the secret or the signature in plaintext.
5. Document the exact header name and algorithm in your adapter README.

Common provider header names:

| Provider | Header | Algorithm |
|---|---|---|
| Paystack | `X-Paystack-Signature` | HMAC-SHA512 |
| Flutterwave | `verif-hash` | literal secret comparison |
| Stripe | `Stripe-Signature` | HMAC-SHA256 with timestamp prefix |
| GitHub | `X-Hub-Signature-256` | HMAC-SHA256 |

For providers that use a timestamp prefix in the signature (like Stripe), extract and verify the timestamp separately to protect against replay attacks.

---

## HTTP Runtime Contract

Adapters with `"runtime": { "type": "http" }` in `adapter.json` run as a separate HTTP service rather than as an in-process module. Ledgerise calls the service over HTTP instead of importing it directly.

This runtime type is intended for adapters maintained outside the monorepo, or for adapters written in a different language.

An HTTP adapter must expose the following endpoints:

### `GET /meta`

Returns the adapter metadata JSON object (same shape as `adapter.json`). Called once at registration and periodically to detect version changes.

```
HTTP 200
Content-Type: application/json

{
  "name": "acme-pay-poll",
  "version": "1.0.0",
  "direction": "inbound",
  "source_system": "acme-pay",
  "modes": ["poll"],
  "currency_codes": ["NGN", "USD"],
  "runtime": { "type": "http" }
}
```

### `POST /validate`

Accepts the adapter's input object as the request body. Returns a validation result.

Request:
```
POST /validate
Content-Type: application/json

{ "config": { ... }, "payload": { ... } }
```

Response (success):
```json
{ "valid": true, "errors": [] }
```

Response (failure):
```json
{
  "valid": false,
  "errors": [
    { "field": "config.apiKey", "message": "apiKey is required", "raw_value": null }
  ]
}
```

### `POST /normalize`

Accepts the adapter's input object. Returns a canonical records envelope.

Request:
```
POST /normalize
Content-Type: application/json

{ "cursor": { ... }, "config": { ... } }
```

Response (success):
```json
{
  "status": "ok",
  "records": [ ...canonical transaction records... ],
  "cursor": { "after_id": "TX-001", "after_timestamp": "2026-06-01T08:00:00Z" },
  "row_errors": []
}
```

Response (error):
```json
{
  "status": "error",
  "code": "AUTH_FAILED",
  "message": "API key rejected by Acme Pay",
  "raw": { "url": "https://api.acmepay.io/v1/transactions" }
}
```

### `GET /healthcheck`

Returns the adapter's connectivity status.

Response (ok):
```json
{ "status": "ok", "latency_ms": 82, "checked_at": "2026-06-01T08:00:00Z" }
```

Response (error):
```json
{ "status": "error", "code": "SOURCE_UNREACHABLE", "message": "...", "checked_at": "..." }
```

### HTTP Runtime Security

Ledgerise does not expose HTTP adapter endpoints to the public internet. They must be reachable only by the Ledgerise API/worker on an internal network or via localhost.

Authenticate requests from Ledgerise using a shared bearer token passed in the `Authorization` header. Set this token as an environment variable in both the Ledgerise worker config and the HTTP adapter service. Never accept unauthenticated requests.

---

## Registration

After building the adapter, register it so Ledgerise can discover and route to it.

### Internal adapters (in-process)

1. Add the workspace to `package.json` at the monorepo root:

   ```json
   {
     "workspaces": [
       "adapters/inbound/paystack-webhook"
     ]
   }
   ```

2. Add the package to `apps/api/package.json` as a dependency:

   ```json
   {
     "dependencies": {
       "@ledgerise/adapter-inbound-paystack-webhook": "*"
     }
   }
   ```

3. Register the adapter metadata in `apps/api/src/adapterRegistry.ts`:

   ```ts
   import paystackWebhook from '../../../adapters/inbound/paystack-webhook/adapter.json' with { type: 'json' };

   export const adapterRegistry = [
     // ...existing adapters...
     paystackWebhook as AdapterRegistryEntry,
   ];
   ```

4. Import the adapter's `normalize` function in `apps/api/src/index.ts` and route inbound requests to it in the `POST /api/ingest/:adapterName` handler. Follow the pattern used for `generic-webhook` and `generic-csv`.

5. Run `npm install` from the monorepo root, then `npm run typecheck` and `npm run build`.

### HTTP adapters (external service)

Add the adapter's `adapter.json` to the registry as above. Set the service URL in environment configuration so Ledgerise knows where to send requests. HTTP adapter support requires the HTTP adapter client to be enabled (see `apps/worker` configuration).

---

## Configuration

Adapters must never hardcode credentials, API keys, base URLs, or operator-specific settings. Inject all configuration at call time through a config object your adapter defines and documents.

For internal adapters, config values come from:

1. Operator-supplied values stored in `adapter_configurations` (the Ledgerise settings UI).
2. Environment variables for secrets (never stored in the database).

Name config keys clearly in your interface. Document every key in your README: what it does, whether it is required, and the expected format.

```ts
export interface PaystackWebhookConfig {
  webhookSecret: string;   // Required. From PAYSTACK_WEBHOOK_SECRET env var.
  environment: 'live' | 'test';  // Required. Determines transaction classification.
  productLine: string;     // Required. Written to product.line on every record.
}
```

Secrets must never appear in:
- Adapter log output
- Error payloads returned to clients
- Canonical transaction records or their metadata
- `adapter_configurations` stored values (store a reference key, not the secret itself)

---

## Healthcheck Expectations

| Adapter mode | Healthcheck behavior |
|---|---|
| Webhook | May return `ok` immediately — the source pushes to you. Optionally call a lightweight verification endpoint if the provider supports it. |
| Poll | Must attempt a real network call to the source system and return the latency. A poll adapter with a failing healthcheck is marked inactive. |
| File import | May return `ok` immediately — there is no persistent connection to check. |

A healthcheck must complete within five seconds. Exceeding this will cause Ledgerise to record a timeout error.

---

## Testing Requirements

Every adapter submitted to the registry must include:

1. **A fixture file** in `fixtures/` with a realistic anonymized payload from the source system and the expected canonical field values.

2. **Unit tests** in `tests/` covering at minimum:
   - One settled transaction normalizes without errors.
   - One failed transaction normalizes with `status: "failed"`.
   - One record with a missing required field produces a `VALIDATION_FAILED` envelope.
   - One test-environment record sets `source.environment: "test"`.
   - For webhook adapters: a valid signature passes, an invalid signature fails.
   - For poll adapters: a non-200 API response returns a `SOURCE_UNREACHABLE` error.
   - Normalizing the same record twice returns the same canonical field values (idempotency of mapping, not of `id` generation).

3. **README** documenting:
   - Supported modes.
   - All config keys with types and whether they are required.
   - The `source_id` strategy (which source field maps to it, and what happens if the source provides no stable ID).
   - Any custom `type` values the adapter emits beyond the standard list in `@ledgerise/canonical-types`.
   - The signature verification header and algorithm (webhook adapters).
   - Any known limitations or source system quirks.

---

## What Adapters Must Never Do

- Contain journal mapping logic, COA account codes, or debit/credit rules.
- Write directly to any accounting system or external database.
- Emit a record with `source.environment` absent or defaulted to `"live"` without confirming from source data that the transaction is real.
- Log raw secrets, API keys, or bearer tokens under any circumstances.
- Emit records with top-level fields that are not in `schemas/transaction.schema.json`. Extra fields belong in `metadata`.
- Assume a default currency without explicit source data confirming it.
- Swallow errors silently. All failures must return a structured error envelope.

---

## Quick Checklist

Before opening a pull request:

- [ ] `adapter.json` has a unique `name` following `{source-system}-{mode}` convention.
- [ ] `meta()`, `validate()`, `normalize()`, and `healthcheck()` are all exported.
- [ ] `normalize()` calls `validate()` first and returns its errors if validation fails.
- [ ] Every output record passes `validateCanonicalTransaction` from `@ledgerise/core-schema`.
- [ ] Every record has a fresh UUID `id` and `processed_at` timestamp.
- [ ] Monetary amounts are in the smallest currency unit (kobo, cents, etc.) before emitting.
- [ ] Webhook adapter verifies HMAC signature with `timingSafeEqual` in `validate()`.
- [ ] Poll adapter advances the cursor only when records are successfully emitted.
- [ ] Healthcheck makes a real network call for poll adapters.
- [ ] Fixtures cover at least one settled and one failed transaction.
- [ ] Tests cover signature verification, missing fields, and environment classification.
- [ ] README documents every config key, the `source_id` strategy, and any custom types.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
