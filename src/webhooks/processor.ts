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

export type PaymentEvent = {
  id: string;
  type: PaymentEventType;
  paymentId: string;
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
  | {
      kind: "rejected";
      state: PaymentState;
      reason: string;
    };

export function applyPaymentEvent(
  payment: {
    id: string;
    state: PaymentState;
  },
  event: PaymentEvent,
  processedEventIds: Set<string>,
): ApplyResult {
  if (processedEventIds.has(event.id)) {
    return {
      kind: "duplicate",
      state: payment.state,
    };
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
      if (payment.state === "CapturePending")
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
      if (payment.state === "CapturePending")
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
