import { mapChannelToPaymentMethod } from "@school/types";

describe("mapChannelToPaymentMethod (shared between Monnify and Paystack)", () => {
  it.each([
    ["CARD", "GATEWAY_CARD"],
    ["card", "GATEWAY_CARD"],
    ["ACCOUNT_TRANSFER", "GATEWAY_TRANSFER"],
    ["bank_transfer", "GATEWAY_TRANSFER"],
    ["BANK", "GATEWAY_TRANSFER"],
    ["USSD", "GATEWAY_USSD"],
    ["ussd", "GATEWAY_USSD"],
    ["DEDICATED_NUBAN", "GATEWAY_RESERVED_ACCOUNT"],
    ["dedicated_nuban", "GATEWAY_RESERVED_ACCOUNT"],
    ["RESERVED_ACCOUNT", "GATEWAY_RESERVED_ACCOUNT"],
  ])("maps %s to %s", (channel, expected) => {
    expect(mapChannelToPaymentMethod(channel)).toBe(expected);
  });

  it("falls back to GATEWAY_CARD for an unrecognized channel", () => {
    expect(mapChannelToPaymentMethod("some-future-channel")).toBe("GATEWAY_CARD");
  });
});
