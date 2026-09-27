# Payment Webhooks

## Context

Bladepay communicates with external payment providers to authorize and capture payments. Some operations from payment providers are asynchronus and can arrive later via webhooks instead of immediate response from API response.

Webhook delivery is not a normal request-response format. It may:

- Deliver the same event more than once
- Retry delivery after a timeout or a non-2xx response
- Deliver events after a delay
- Send an event while Bladepay is not available (due to temperory outage)
- Send a forged or modified event if the endpoint is not secure

Bladepay must process these event safely without applying the payment status transition or side effects twice.

## Decision

Bladepay will expose a dedicated HTTPS webhook endpoint for each supported payment provider.

The webhook handler will:

- Receive a raw request body
- Verify the payment provider signature before trusting or processing the payload
- Reject requests with an invalid signature
- Persist the event in durable inbox -> Use a tool like a RabbitMQ or Kafka?
- Deduplicate events using the provider event ID
- Return a successful 2xx response after durable persistence
- Process the event asynchronously
- Apply one valid payment state transisitons.
- Reconcile uncertain payments through Provider API

## HTTPS and Endpoint Security

Webhook endpoints must use HTTPS in non-local environments. This is inpired from [How Stripe treats Webhooks](https://docs.stripe.com/webhooks).

HTTPS protects the request while is traveling between Bladepay and provider but HTTPS doesn't alone guarantee that the request came from the actual provider, so Bladepay must also verify the provider's webhook signature.

Signature webhook must use:

- The exact raw request body
- The provider signature header
- The configured webhook signing secret
- A reply-protection timestamp, when supported by provider

A request body must not parse, re-serialize or reformatted before the Signature verification is done.

Invalid Signature must not update payment state.