import { signBuyerToken, verifyBuyerToken } from "../src/orders/buyer-token";

describe("buyer token", () => {
  const secret = "test-secret";

  it("round-trips the buyer id and rejects a swapped id", () => {
    const token = signBuyerToken("3", secret);
    expect(verifyBuyerToken(token, secret)).toBe("3");

    const forged = `4.${token.split(".")[1]}`;
    expect(verifyBuyerToken(forged, secret)).toBeNull();
    expect(verifyBuyerToken(token, "other-secret")).toBeNull();
  });
});
