import { describe, expect, it } from "vitest";
import { braintrustProject, resolveEnvironment } from "./environment";

describe("resolveEnvironment", () => {
  it.each(["production", "preview", "development"] as const)(
    "takes VERCEL_ENV=%s as authoritative",
    (value) => {
      expect(resolveEnvironment({ VERCEL_ENV: value })).toBe(value);
    },
  );

  it("ignores an unrecognized VERCEL_ENV", () => {
    expect(resolveEnvironment({ VERCEL_ENV: "staging" })).toBe("development");
  });

  it("falls back to NODE_ENV=production off platform", () => {
    expect(resolveEnvironment({ NODE_ENV: "production" })).toBe("production");
  });

  it("defaults to development with neither variable set", () => {
    expect(resolveEnvironment({})).toBe("development");
  });

  it("prefers VERCEL_ENV over NODE_ENV", () => {
    expect(
      resolveEnvironment({ NODE_ENV: "production", VERCEL_ENV: "preview" }),
    ).toBe("preview");
  });
});

describe("braintrustProject", () => {
  it("uses the bare agent name in production", () => {
    expect(braintrustProject("adam", "production")).toBe("adam");
  });

  it.each([
    ["preview", "adam-preview"],
    ["development", "adam-dev"],
  ] as const)("suffixes %s", (environment, expected) => {
    expect(braintrustProject("adam", environment)).toBe(expected);
  });

  it("resolves the environment when none is passed", () => {
    expect(braintrustProject("adam")).toMatch(/^adam(-preview|-dev)?$/);
  });
});
