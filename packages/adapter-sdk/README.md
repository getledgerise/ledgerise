# Adapter SDK

Shared adapter contract types and helpers.

The SDK should help internal adapters and external adapter authors implement the same contract without coupling adapters to the core engine.

## Exports

- `AdapterMeta`
- `AdapterValidationResult`
- `AdapterValidationError`
- `AdapterResult`
- `AdapterSuccess`
- `AdapterError`
- `AdapterHealthcheckResult`
- `AdapterModule`
- `ok(records, cursor?)`
- `validationFailed(message, errors, raw?)`
- `adapterError(code, message, raw?)`
