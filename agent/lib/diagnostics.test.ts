import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { neverThrow } from "./diagnostics";

describe("neverThrow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the body", () => {
    const body = vi.fn();
    neverThrow("test", body);

    expect(body).toHaveBeenCalledTimes(1);
  });

  it("swallows a failure and reports it through diag", () => {
    const error = new Error("transport closed");
    vi.spyOn(diag, "error").mockImplementation(() => undefined);

    expect(() =>
      neverThrow("turn.failed instrumentation", () => {
        throw error;
      }),
    ).not.toThrow();
    expect(diag.error).toHaveBeenCalledWith(
      "turn.failed instrumentation failed",
      error,
    );
  });
});

describe("ensureOtelDiagnostics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(diag, "setLogger").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("installs a console diag logger at error level", async () => {
    const { ensureOtelDiagnostics } = await import("./diagnostics");
    ensureOtelDiagnostics();

    expect(diag.setLogger).toHaveBeenCalledWith(
      expect.any(DiagConsoleLogger),
      DiagLogLevel.ERROR,
    );
  });

  it("installs once per process", async () => {
    const { ensureOtelDiagnostics } = await import("./diagnostics");
    ensureOtelDiagnostics();
    ensureOtelDiagnostics();

    expect(diag.setLogger).toHaveBeenCalledTimes(1);
  });
});
