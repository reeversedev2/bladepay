# Payment Webhooks

## Context

Bladepay communicates with external payment providers to authorize and capture payments. Some operations from payment providers are asynchronous and can arrive later through webhooks instead of the immediate API response.

Webhook delivery is not a normal request-response format. It may:

- Deliver the same event more than once.
- Retry delivery after a timeout or a non-2xx response.
- Deliver events after a delay.
- Send an event while Bladepay is temporarily unavailable.
- Send a forged or modified event if the endpoint is not secure.

Bladepay must process these events safely without applying a payment state transition or side effect twice.

## Decision

Bladepay will expose a dedicated HTTPS webhook endpoint for each supported payment provider. Each provider adapter will implement its own signature verification and payload normalization behind a common webhook-ingestion interface.

The webhook handler will:

1. Receive the exact raw request body and provider signature headers.
2. Verify the payment provider signature before parsing, normalizing, trusting, or processing the payload.
3. Reject requests with an invalid signature.
4. Parse and validate the authenticated payload.
5. Persist the event in a database-backed durable inbox.
6. Deduplicate events using a unique `(provider, provider_event_id)` constraint.
7. Return a successful 2xx response only after durable persistence commits.
8. Publish the persisted event asynchronously to a payment-event broker.
9. Process the event asynchronously.
10. Apply at most one valid payment state transition and idempotent side effects.
11. Reconcile uncertain payments through the provider API.

The database inbox is the durable source of truth. A message broker is the delivery mechanism for asynchronous processing, not the only record of webhook receipt.

RabbitMQ is the initial broker choice because the workload is task-oriented and requires acknowledgements, retries, and dead-lettering. Kafka is not required for the current workload's partitioned event-log needs. The broker must be accessed through an application interface so this decision can be revisited without changing webhook ingestion.

## HTTPS and Endpoint Security

Webhook endpoints must use HTTPS in all non-local environments. This is inspired by [How Stripe treats Webhooks](https://docs.stripe.com/webhooks).

HTTPS protects the request while it travels between Bladepay and the provider, but HTTPS alone does not guarantee that the request came from the actual provider. Bladepay must also verify the provider's webhook signature.

Signature verification must use:

- The exact raw request body.
- The provider signature header.
- The configured provider-specific webhook signing secret or key.
- A provider timestamp, when supported.
- A configured replay-protection tolerance, when timestamps are supported.

The request body must not be parsed, re-serialized, reformatted, decompressed, or otherwise modified before signature verification.

Invalid signatures, malformed signature headers, expired timestamps, and requests outside the replay window must be rejected. They must not update payment state or enter the durable inbox.

Signing secrets must be stored in the approved secret manager. Secret rotation must support an overlap period during which the active and previous secret can be verified, followed by removal of the old secret.

Each provider endpoint must enforce a maximum request body size and rate limit. Logs must not contain signing secrets, full authorization values, or unnecessary payment data.

## Durable inbox

The inbox is a database table owned by the payments service. A representative schema is:

- `id`: internal event identifier.
- `provider`: provider name.
- `provider_event_id`: provider event identifier.
- `received_at`: server receipt time.
- `occurred_at`: provider event time, when available.
- `raw_payload`: original authenticated body, encrypted or access-controlled as required.
- `payload_hash`: hash of the raw body for diagnostics.
- `normalized_type`: validated internal event type.
- `status`: `received`, `published`, `processing`, `processed`, or `failed`.
- `attempt_count`: processing attempt count.
- `last_error`: sanitized failure information.
- `processed_at`: completion time.

A unique database constraint on `(provider, provider_event_id)` makes duplicate delivery safe. The provider must be part of the key because event IDs are not assumed to be globally unique across providers.

When a duplicate event is received with the same provider and event ID, Bladepay must not create another inbox record. It may return 2xx if the original event was durably persisted. If the duplicate has a different payload hash, Bladepay must retain an audit signal and alert or quarantine the event for investigation; it must not silently overwrite the original payload.

Inbox retention must be long enough to cover provider retry windows, operational replay needs, and audit requirements. The payments team must define the production retention period through data-retention policy before launch.

## Publishing and asynchronous processing

A committed inbox record must eventually be published to RabbitMQ. Publishing must be reliable across process crashes. Bladepay will use an inbox publisher with a claim/lease or an equivalent transactional outbox mechanism so that a crash between database commit and broker publish does not permanently lose an event.

The worker must acknowledge the RabbitMQ message only after processing succeeds or the event has been deliberately classified as permanently unprocessable.

Transient failures use bounded retries with exponential backoff. Exhausted messages go to a dead-letter queue and remain associated with the inbox record. Operators must be able to inspect and safely replay a failed event.

A worker crash or broker redelivery is expected. Therefore broker delivery is at-least-once, and every consumer operation must be idempotent.

## Payment state transitions

The payment state machine is the authority for applying provider events. Each event handler must:

- Load the payment using a stable payment identifier.
- Validate the requested transition against the current state.
- Apply the transition transactionally.
- Record the provider event ID as having been applied, or use an equivalent unique operation key.
- Make all external side effects idempotent.

A duplicate or already-applied event is treated as a successful no-op. A stale, contradictory, or invalid transition must not move the payment backwards or create side effects. It must be recorded for investigation according to the event policy.

The implementation must explicitly document the valid transition matrix for authorization, capture, failure, cancellation, refund, and any provider-specific states before production launch.

## Reconciliation

Bladepay will reconcile a payment through the provider API when the result is uncertain, including a request timeout after submission, an ambiguous provider response, an event that cannot be correlated, or an event-processing failure that cannot safely determine the final state.

Reconciliation must be:

- Idempotent.
- Rate-limited.
- Retried with bounded backoff.
- Protected against stale provider responses.
- Recorded with the provider request ID where available.

Each provider integration must define its reconciliation schedule, maximum duration, terminal conditions, and escalation behavior. Reconciliation must use the same payment state-transition rules as webhook processing.

## HTTP response behavior

- Invalid signature: return a non-2xx response and do not persist the event.
- Valid signature but malformed or unsupported payload: persist an authenticated rejection record when possible, then return a non-2xx response if provider correction or retry is useful.
- Valid and accepted event: return 2xx after durable inbox commit, even if asynchronous processing has not completed.
- Duplicate of a durably persisted event: return 2xx and perform no duplicate side effects.
- Temporary Bladepay failure before inbox commit: return non-2xx or allow the request to time out so the provider retries.

The exact status codes and provider-specific response bodies are defined by each provider adapter.

## Observability and audit

Bladepay must emit metrics and structured logs for:

- Signature failures and replay-window failures.
- Accepted, duplicate, malformed, and rejected events.
- Inbox commit latency and age of the oldest unprocessed event.
- Broker publish failures and dead-letter count.
- Processing attempts, transition conflicts, and reconciliation attempts.
- End-to-end webhook-to-payment-state latency.

Every event must be traceable using an internal correlation ID, provider name, provider event ID, payment ID when known, and provider request ID when available. Sensitive payload fields must be redacted from normal logs.

Alerts must cover sustained signature failures, inbox backlog, publish failures, dead-letter growth, reconciliation backlog, and abnormal provider delivery patterns.

## Testing requirements

Before production launch, each provider adapter must have tests for:

- Valid signatures.
- Invalid signatures.
- Modified bodies.
- Timestamp replay attacks.
- Duplicate delivery.
- Duplicate IDs with different payloads.
- Delayed and out-of-order events.
- Broker redelivery and worker crashes.
- Database commit followed by process failure.
- Valid, stale, contradictory, and invalid state transitions.
- Reconciliation after ambiguous API responses.
- Secret rotation during the overlap period.

An end-to-end test must verify that a webhook is not acknowledged before durable persistence and that repeated delivery produces only one payment transition and one set of idempotent side effects.

## Consequences

### Positive

- Forged events cannot update payment state without a valid signature.
- Provider retries are safe because receipt is durable and deduplicated.
- A temporary Bladepay outage does not lose authenticated events after provider retry succeeds.
- Webhook response latency is separated from payment-processing latency.
- RabbitMQ provides acknowledgement, retry, and dead-letter semantics suitable for workers.
- The database inbox provides an auditable source of truth and a replay path.

### Negative

- The system has both a database inbox and a broker to operate.
- At-least-once delivery requires idempotency in every consumer and side effect.
- Raw payload retention increases storage and data-governance responsibilities.
- Provider-specific signature and payload behavior requires adapter code and contract tests.
- Reconciliation adds provider API load and operational complexity.

## Follow-up decisions

The following are implementation details rather than blockers to this architectural decision:

1. Final inbox retention period and payload encryption policy.
2. Exact payment state-transition matrix.
3. RabbitMQ exchange, queue, retry, and dead-letter topology.
4. Provider-specific status codes and response bodies.
5. Reconciliation intervals and escalation thresholds.
6. Secret-manager integration and rotation runbook.
7. Dashboard and alert thresholds.

These must be documented before the first provider integration is promoted to production.
