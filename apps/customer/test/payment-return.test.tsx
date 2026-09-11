import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { Redirect } from "expo-router";

import PaymentReturn from "../src/app/payment/return";

vi.mock("expo-router", () => ({ Redirect: "Redirect" }));

describe("YooKassa return route", () => {
  it("returns to the customer app without treating the redirect as payment proof", async () => {
    let rendered: ReactTestRenderer | undefined;
    await act(async () => {
      rendered = create(<PaymentReturn />);
    });

    expect(rendered?.root.findByType(Redirect).props["href"]).toBe("/");
  });
});
