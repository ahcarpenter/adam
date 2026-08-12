import { diag } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushOnExit } from "./shutdown";

function emitBeforeExit(): void {
  process.emit("beforeExit", 0);
}

describe("flushOnExit", () => {
  afterEach(() => {
    process.removeAllListeners("beforeExit");
    vi.restoreAllMocks();
  });

  it("shuts the provider down when the process is about to exit", () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    flushOnExit({ shutdown });

    expect(shutdown).not.toHaveBeenCalled();
    emitBeforeExit();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("only drains once", () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    flushOnExit({ shutdown });

    emitBeforeExit();
    emitBeforeExit();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("reports a failed drain through diag instead of throwing", async () => {
    const error = new Error("exporter unreachable");
    vi.spyOn(diag, "error").mockImplementation(() => undefined);
    flushOnExit({ shutdown: vi.fn().mockRejectedValue(error) });

    emitBeforeExit();
    await vi.waitFor(() =>
      expect(diag.error).toHaveBeenCalledWith(
        "telemetry provider shutdown failed",
        error,
      ),
    );
  });
});
