import { describe, expect, test } from "vitest";
import { applyPaymentEvent } from "./processor";

describe("should transition CapturePending correctly", () => {
  test("should transition from CapturePending to Captured when capture succeeded event", () => {
    expect(
      applyPaymentEvent(
        {
          id: "123",
          state: "CapturePending",
        },
        {
          id: "2312",
          type: "capture.succeeded",
          paymentId: "123",
        },
        new Set(["123", "1323"]),
      ),
    ).toMatchObject({
      kind: "applied",
      state: "Captured",
    });
  });

  test("should transition from CapturePending to Failed when capture failed event", () => {
    expect(
      applyPaymentEvent(
        {
          id: "123",
          state: "CapturePending",
        },
        {
          id: "2312",
          type: "capture.failed",
          paymentId: "123",
        },
        new Set(["123", "1323"]),
      ),
    ).toMatchObject({
      kind: "applied",
      state: "Failed",
    });
  });
});

describe("should transition Unknown correctly", () => {
  test("should reject Unknown to Captured when capture succeeded event", () => {
    expect(
      applyPaymentEvent(
        {
          id: "123",
          state: "Unknown",
        },
        {
          id: "2312",
          type: "capture.succeeded",
          paymentId: "123",
        },
        new Set(["123", "1323"]),
      ),
    ).toMatchObject({
      kind: "rejected",
      state: "Unknown",
    });
  });
});
