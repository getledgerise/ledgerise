# Core Schema

Canonical transaction validation and type generation.

This module owns validation against `schemas/transaction.schema.json` and should expose UI-friendly validation errors.

## Public API

- `validateCanonicalTransaction(input)` returns `{ valid, errors }`.
- `assertCanonicalTransaction(input)` narrows valid input and throws `CanonicalTransactionValidationError` on failure.
- `isCanonicalTransaction(input)` is a boolean type guard.
- `getCanonicalTransactionSchema()` returns the loaded JSON schema.

Validation errors include:

- `fieldPath`
- `message`
- `rawValue`
- `keyword`
