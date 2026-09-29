import { describe, expect, it } from "vitest";
import { attributeStep } from "./step-attribution";

function principal(principalId: string) {
  return {
    attributes: {},
    authenticator: "test",
    principalId,
    principalType: "user",
  };
}

describe("attributeStep", () => {
  it("attributes to the initiator when both principals are present", () => {
    expect(
      attributeStep({
        initiator: principal("human"),
        current: principal("subagent"),
      }),
    ).toEqual({ posthog_distinct_id: "human" });
  });

  it("falls back to the current principal without an initiator", () => {
    expect(
      attributeStep({ initiator: null, current: principal("user-7") }),
    ).toEqual({ posthog_distinct_id: "user-7" });
  });

  it("contributes nothing when unauthenticated", () => {
    expect(attributeStep({ initiator: null, current: null })).toBeUndefined();
  });
});
