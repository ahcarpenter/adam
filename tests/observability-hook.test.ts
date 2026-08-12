import { beforeEach, describe, expect, it } from "vitest";
import TransportStream from "winston-transport";
import hook from "../agent/hooks/observability";
import { configureDefaultLogger } from "../agent/lib/logger";

class MemoryTransport extends TransportStream {
  public readonly records: Record<string, unknown>[] = [];

  override log(info: Record<string, unknown>, callback: () => void): void {
    this.records.push(info);
    callback();
  }
}

const ctx = {
  agent: { name: "adam" },
  channel: { kind: "http" },
  session: { id: "sess_1" },
};

// Handlers only read the fields constructed below; the full runtime event
// types are much wider, hence the localized casts.
function fire(eventType: string, data: Record<string, unknown>): void {
  const handler = (hook as { events: Record<string, unknown> }).events[
    eventType
  ] as (event: { data: Record<string, unknown> }, hookCtx: typeof ctx) => void;
  handler({ data }, ctx);
}

describe("observability hook", () => {
  let memory: MemoryTransport;

  beforeEach(() => {
    memory = new MemoryTransport();
    configureDefaultLogger({ extraTransports: [memory] });
  });

  it("logs session lifecycle", () => {
    fire("session.started", {});
    expect(memory.records.at(-1)).toMatchObject({
      level: "info",
      message: "session started",
      sessionId: "sess_1",
      channel: "http",
    });
  });

  it("logs turn lifecycle", () => {
    fire("turn.started", { turnId: "turn_0" });
    fire("turn.completed", { turnId: "turn_0" });
    expect(memory.records.map((r) => r.message)).toEqual([
      "turn started",
      "turn completed",
    ]);
    expect(memory.records.at(-1)).toMatchObject({ turnId: "turn_0" });
  });

  it("logs failures at error level with code and message", () => {
    fire("turn.failed", {
      turnId: "turn_0",
      code: "model_error",
      message: "boom",
    });
    fire("session.failed", { code: "fatal", message: "dead" });
    expect(memory.records[0]).toMatchObject({
      level: "error",
      message: "turn failed",
      code: "model_error",
      error: "boom",
    });
    expect(memory.records[1]).toMatchObject({
      level: "error",
      message: "session failed",
      code: "fatal",
      error: "dead",
    });
  });

  it("logs tool, subagent, and skill results with a resolved name", () => {
    fire("action.result", {
      turnId: "turn_0",
      status: "completed",
      result: {
        kind: "tool-result",
        toolName: "agentkit__save_memory",
        callId: "c1",
      },
    });
    fire("action.result", {
      turnId: "turn_0",
      status: "completed",
      result: {
        kind: "subagent-result",
        subagentName: "researcher",
        callId: "c2",
      },
    });
    fire("action.result", {
      turnId: "turn_0",
      status: "completed",
      result: { kind: "load-skill-result", name: "playbook", callId: "c3" },
    });
    expect(memory.records.map((r) => r.toolName)).toEqual([
      "agentkit__save_memory",
      "researcher",
      "playbook",
    ]);
  });
});
