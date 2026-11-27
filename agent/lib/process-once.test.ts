import { afterEach, describe, expect, it, vi } from "vitest";
import { oncePerProcess } from "./process-once";

const name = "process-once-test";

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for(`adam.once-per-process.${name}`)
  ];
});

describe("oncePerProcess", () => {
  it("runs once however many times it is called", () => {
    const run = vi.fn();
    oncePerProcess(name, run);
    oncePerProcess(name, run);

    expect(run).toHaveBeenCalledOnce();
  });

  it("runs once across fresh copies of the module", async () => {
    const run = vi.fn();
    oncePerProcess(name, run);
    vi.resetModules();
    const copy = await import("./process-once");
    copy.oncePerProcess(name, run);

    expect(run).toHaveBeenCalledOnce();
  });

  it("runs again after a call that threw", () => {
    const run = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("not yet");
      })
      .mockImplementationOnce(() => undefined);
    expect(() => oncePerProcess(name, run)).toThrow("not yet");
    oncePerProcess(name, run);
    oncePerProcess(name, run);

    expect(run).toHaveBeenCalledTimes(2);
  });
});
