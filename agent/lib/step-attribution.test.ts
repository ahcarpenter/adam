import { type Span, trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  const setAttribute = vi.fn();

  beforeEach(() => {
    setAttribute.mockClear();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue({
      setAttribute,
    } as unknown as Span);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attributes to the initiator when both principals are present", () => {
    const result = attributeStep({
      initiator: principal("human"),
      current: principal("subagent"),
    });

    expect(result).toEqual({
      runtimeContext: { posthog_distinct_id: "human" },
    });
    expect(setAttribute).toHaveBeenCalledWith("posthog.distinct_id", "human");
  });

  it("falls back to the current principal without an initiator", () => {
    const result = attributeStep({
      initiator: null,
      current: principal("user-7"),
    });

    expect(result).toEqual({
      runtimeContext: { posthog_distinct_id: "user-7" },
    });
    expect(setAttribute).toHaveBeenCalledWith("posthog.distinct_id", "user-7");
  });

  it("returns undefined and leaves the span untouched when unauthenticated", () => {
    expect(attributeStep({ initiator: null, current: null })).toBeUndefined();
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it("merges the distinct id on top of an earlier handler's context", () => {
    const result = attributeStep(
      { initiator: principal("human"), current: null },
      { runtimeContext: { braintrust_span: "abc" } },
    );

    expect(result).toEqual({
      runtimeContext: { braintrust_span: "abc", posthog_distinct_id: "human" },
    });
  });

  it("passes an earlier handler's context through when unauthenticated", () => {
    const result = attributeStep(
      { initiator: null, current: null },
      { runtimeContext: { braintrust_span: "abc" } },
    );

    expect(result).toEqual({ runtimeContext: { braintrust_span: "abc" } });
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it("contributes runtime context even without an active span", () => {
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(undefined);

    expect(
      attributeStep({ initiator: principal("human"), current: null }),
    ).toEqual({ runtimeContext: { posthog_distinct_id: "human" } });
  });
});
