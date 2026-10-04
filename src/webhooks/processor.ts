type PaymentState =
  | "Created"
  | "AuthorizationPending"
  | "Authorized"
  | "CapturePending"
  | "Captured"
  | "Failed"
  | "Cancelled"
  | "Unknown";

type PaymentEventType =
  | "authorization.succeeded"
  | "authorization.failed"
  | "capture.succeeded"
  | "capture.failed";

type Payment = {
  id: string;
  state: PaymentState;
};

export type PaymentEvent = {
  id: string;
  type: PaymentEventType;
  paymentId: string;
};

type RejectedApplyResult = {
  kind: "rejected";
  state: PaymentState;
  reason: string;
};

type ApplyResult =
  | {
      kind: "applied";
      state: PaymentState;
    }
  | {
      kind: "duplicate";
      state: PaymentState;
    }
  | RejectedApplyResult;

const validateEventPaymentId = (
  event: PaymentEvent,
  payment: Payment,
): RejectedApplyResult | undefined => {
  if (event.paymentId !== payment.id) {
    return {
      kind: "rejected",
      state: payment.state,
      reason: "Event belongs to a different payment",
    };
  }
};

export function applyPaymentEvent(
  payment: Payment,
  event: PaymentEvent,
  processedEventIds: Set<string>,
): ApplyResult {
  if (processedEventIds.has(event.id)) {
    return {
      kind: "duplicate",
      state: payment.state,
    };
  }
  const paymentMatchResult = validateEventPaymentId(event, payment);

  if (paymentMatchResult) {
    return paymentMatchResult;
  }

  switch (event.type) {
    case "authorization.succeeded":
      if (payment.state === "AuthorizationPending")
        return {
          kind: "applied",
          state: "Authorized",
        };
      return {
        kind: "rejected",
        state: payment.state,
        reason: "Invalid Transition",
      };
    case "authorization.failed":
      if (payment.state === "AuthorizationPending")
        return {
          kind: "applied",
          state: "Failed",
        };
      return {
        kind: "rejected",
        state: payment.state,
        reason: "Invalid Transition",
      };
    case "capture.succeeded":
      if (["CapturePending", "Unknown"].includes(payment.state))
        return {
          kind: "applied",
          state: "Captured",
        };
      return {
        kind: "rejected",
        state: payment.state,
        reason: "Invalid Transition",
      };

    case "capture.failed":
      if (["CapturePending", "Unknown"].includes(payment.state))
        return {
          kind: "applied",
          state: "Failed",
        };
      return {
        kind: "rejected",
        state: payment.state,
        reason: "Invalid Transition",
      };

    default:
      return {
        kind: "rejected",
        state: payment.state,
        reason: "Invalid Transition",
      };
  }
}
