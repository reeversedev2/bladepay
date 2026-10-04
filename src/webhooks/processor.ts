type PaymentState =
  | "Created"
  | "AuthrorizationPending"
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
  switch (event.type) {
    case "authorization.succeeded":
      if (payment.state === "AuthrorizationPending")
        return {
          kind: "applied",
          state: "Authorized",
        };
      if (payment.state === "Authorized") {
        return {
          kind: "duplicate",
          state: payment.state,
        };
      }
      return {
        kind: "rejected",
        state: payment.state,
        reason: "Invalid Transition",
      };
    case "authorization.failed":
      if (payment.state === "AuthrorizationPending")
        return {
          kind: "applied",
          state: "Failed",
        };
      if (payment.state === "Failed") {
        return {
          kind: "duplicate",
          state: payment.state,
        };
      }
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
      if (payment.state === "Captured") {
        return {
          kind: "duplicate",
          state: payment.state,
        };
      }
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
      if (payment.state === "Failed") {
        return {
          kind: "duplicate",
          state: payment.state,
        };
      }
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
