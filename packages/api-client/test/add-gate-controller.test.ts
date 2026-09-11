import { describe, expect, it } from "vitest";

import { createAddGateController } from "../src/add-gate-controller.js";

describe("add-gate controller", () => {
  it("keeps only a product reference until identify succeeds", () => {
    const controller = createAddGateController();
    expect(controller.request({ productId: 4, quantity: 1 }, { status: "anonymous" })).toBeNull();
    expect(controller.consume()).toEqual({ productId: 4, quantity: 1 });
    expect(controller.consume()).toBeNull();
    controller.request({ productId: 4, quantity: 1 }, { status: "anonymous" });
    controller.cancel();
    expect(controller.consume()).toBeNull();
  });
});
