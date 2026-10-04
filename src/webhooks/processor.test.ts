import { describe, expect, test } from "vitest";
import { applyPaymentEvent, type PaymentEvent } from "./processor";

const paymentId = "123";

const createEvent = (
  type: PaymentEvent["type"],
  id: string,
  eventPaymentId = paymentId,
): PaymentEvent => ({
  id,
  type,
  paymentId: eventPaymentId,
});

describe("applyPaymentEvent", () => {
  describe("applied events", () => {
    test("transitions CapturePending to Captured after capture succeeds", () => {
      expect(
        applyPaymentEvent(
          { id: paymentId, state: "CapturePending" },
          createEvent("capture.succeeded", "event_101"),
          new Set(),
        ),
      ).toEqual({ kind: "applied", state: "Captured" });
    });

    test("transitions CapturePending to Failed after capture fails", () => {
      expect(
        applyPaymentEvent(
          { id: paymentId, state: "CapturePending" },
          createEvent("capture.failed", "event_102"),
          new Set(),
        ),
      ).toEqual({ kind: "applied", state: "Failed" });
    });

    test("transitions AuthorizationPending to Authorized after authorization succeeds", () => {
      expect(
        applyPaymentEvent(
          { id: paymentId, state: "AuthorizationPending" },
          createEvent("authorization.succeeded", "event_103"),
          new Set(),
        ),
      ).toEqual({ kind: "applied", state: "Authorized" });
    });

    test("transitions AuthorizationPending to Failed after authorization fails", () => {
      expect(
        applyPaymentEvent(
          { id: paymentId, state: "AuthorizationPending" },
          createEvent("authorization.failed", "event_104"),
          new Set(),
        ),
      ).toEqual({ kind: "applied", state: "Failed" });
    });

    test("transitions Unknown to Captured after capture succeeds", () => {
      expect(
        applyPaymentEvent(
          { id: paymentId, state: "Unknown" },
          createEvent("capture.succeeded", "event_105"),
          new Set(),
        ),
      ).toEqual({ kind: "applied", state: "Captured" });
    });
  });

  describe("duplicate events", () => {
    test("returns duplicate without changing the payment state", () => {
      expect(
        applyPaymentEvent(
          { id: paymentId, state: "Unknown" },
          createEvent("capture.succeeded", "event_106"),
          new Set(["event_106"]),
        ),
      ).toEqual({ kind: "duplicate", state: "Unknown" });
    });
  });

  describe("rejected events", () => {
    test("rejects an event belonging to a different payment", () => {
      expect(
        applyPaymentEvent(
          { id: paymentId, state: "CapturePending" },
          createEvent("capture.succeeded", "event_107", "456"),
          new Set(),
        ),
      ).toEqual({
        kind: "rejected",
        state: "CapturePending",
        reason: "Event belongs to a different payment",
      });
    });

    test("rejects a valid event from an invalid state", () => {
      expect(
        applyPaymentEvent(
          { id: paymentId, state: "Captured" },
          createEvent("capture.failed", "event_108"),
          new Set(),
        ),
      ).toEqual({
        kind: "rejected",
        state: "Captured",
        reason: "Invalid Transition",
      });
    });

    test.each([
      ["authorization.succeeded", "Created"],
      ["authorization.failed", "Authorized"],
      ["capture.succeeded", "Failed"],
    ] as const)("rejects %s from %s", (eventType, state) => {
      expect(
        applyPaymentEvent(
          { id: paymentId, state },
          createEvent(eventType, `invalid-${eventType}`),
          new Set(),
        ),
      ).toEqual({
        kind: "rejected",
        state,
        reason: "Invalid Transition",
      });
    });
  });
});
