# Payment Lifecycle Status and Idempotency

## Payment lifecycle statuses

A payment can have the following lifecycle states:

- `Created` — payment record exists, but processing has not started.
- `AuthorizationPending` — authorization request was sent or is being processed.
- `Authorized` — provider confirmed that the payment amount is authorized.
- `CapturePending` — capture request was sent or is being processed.
- `Captured` — provider confirmed that the funds were captured.
- `Failed` — the current payment operation failed definitively.
- `Cancelled` — the payment was cancelled before capture.
- `Unknown` — the gateway cannot determine whether the provider processed the operation.

`Unknown` is not the same as `Failed`. It means the gateway needs reconciliation before deciding the final outcome.

## Valid state transitions

```text
Created
  ├──> AuthorizationPending
  ├──> Failed
  └──> Cancelled

AuthorizationPending
  ├──> Authorized
  ├──> Failed
  └──> Unknown

Authorized
  ├──> CapturePending
  └──> Cancelled

CapturePending
  ├──> Captured
  ├──> Failed
  └──> Unknown

Unknown
  ├──> Authorized
  ├──> Captured
  ├──> Failed
  └──> Unknown
```

The exact transition from `Unknown` depends on which operation timed out:

- Authorization timeout → reconcile to `Authorized` or `Failed`
- Capture timeout → reconcile to `Captured` or `Failed`

A captured payment must not transition back to `Failed`. Refunds and reversals are separate operations and are outside this initial lifecycle.

## State invariants

1. A payment cannot be captured unless authorization succeeded, unless the provider supports direct capture.
2. `Captured` is set only after a verified provider response or webhook confirms capture.
3. A timeout must not be treated as a definitive failure.
4. Terminal states cannot be changed by an older or duplicate event.
5. Every state transition must be recorded with a timestamp and source, such as:
   - API response
   - Webhook
   - Reconciliation worker
   - Manual operation

## Idempotency

Idempotency prevents a client retry from creating a second payment when the first request may already have succeeded.

For example:

```http
POST /payments
Idempotency-Key: pay_fur638389
```

The idempotency key identifies one logical payment request. The client must reuse the same key when retrying that request.

The key should not be regenerated for every retry. A browser session may temporarily store the key, but the database is the authoritative source.

### Gateway behavior

The gateway must:

1. Receive and validate the idempotency key.
2. Calculate and store a fingerprint of the relevant request data.
3. Enforce uniqueness:

   ```sql
   UNIQUE (merchant_id, idempotency_key)
   ```

4. Return the existing payment and status when the same merchant reuses the same key with the same request fingerprint.
5. Return `409 Conflict` when the same key is reused with different payment data.
6. Store the response or current payment status so a retry can return a consistent result.
7. Use an atomic database operation when creating the payment record to prevent concurrent requests from creating duplicate attempts.

Example:

```text
Same merchant + same key + same payload
    -> return the existing payment and status

Same merchant + same key + different payload
    -> return 409 Conflict

Different key
    -> treat as a new logical payment request
```

## Provider idempotency

The gateway should use a separate idempotency key for each provider operation:

```text
Gateway idempotency key:    pay_fur638389
Provider authorization key: pay_fur638389:authorize
Provider capture key:       pay_fur638389:capture
```

These provider keys must be persisted with the payment attempt.

If a provider request must be retried, the gateway must reuse the same provider idempotency key. It must never retry the same operation with a newly generated key.

The provider key is not a replacement for the gateway key. The gateway key protects the client-facing API, while the provider key protects the downstream provider request.

## Provider succeeds but the gateway times out

The gateway cannot distinguish between:

1. The provider never received the request.
2. The provider received and rejected the request.
3. The provider processed the request, but the response was lost.

Therefore, a timeout must be treated as an uncertain result.

### Capture timeout flow

1. Persist the payment as `CapturePending` before calling the provider.
2. Send the capture request using the stored provider idempotency key.
3. If the gateway times out:
   - Keep the payment as `CapturePending` or transition it to `Unknown`.
   - Return `202 Accepted` with the payment ID and current status.
   - Do not create a second payment attempt.
4. A reconciliation worker queries the provider using the provider transaction ID or supported lookup mechanism.
5. Reconcile the result:

```text
Provider confirms capture
    -> Captured

Provider confirms failure
    -> Failed

Provider says transaction not found
    -> retry with the same provider idempotency key,
       only if the provider documents this as safe

Provider result remains uncertain
    -> Unknown + operational alert
```

If the provider does not support idempotent retries or status lookup, the gateway must not automatically retry a potentially successful charge. It must reconcile through a webhook, provider report, settlement file, or manual review.

A client retry using the same gateway idempotency key must return the existing payment status and must not create another charge.

## Core rule

> Never infer payment success or failure solely from whether the gateway received a provider response.

The authoritative outcome must come from a verified provider response, a valid webhook, or a successful reconciliation process.
