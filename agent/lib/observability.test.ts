import { diag } from "@opentelemetry/api";
import type { HookContext, HookEvent } from "eve/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransportStream from "winston-transport";
import { configureDefaultLogger } from "./logger";
import { recordToolCall, recordTurn } from "./metrics";
import {
  onActionResult,
  onSessionFailed,
  onStepFailed,
  onTurnCancelled,
  onTurnCompleted,
  onTurnFailed,
  onTurnStarted,
} from "./observability";

vi.mock("./metrics", () => ({
  recordToolCall: vi.fn(),
  recordTurn: vi.fn(),
}));

class MemoryTransport extends TransportStream {
  public readonly records: Record<string, unknown>[] = [];

  override log(info: Record<string, unknown>, callback: () => void): void {
    this.records.push(info);
    callback();
  }
}

let logged: MemoryTransport;

function lastRecord(): Record<string, unknown> {
  const record = logged.records.at(-1);
  if (!record) throw new Error("no log records captured");
  return record;
}

// The handlers read only session.id and channel.kind off the hook context.
function context(sessionId = "sess_1", kind?: string): HookContext {
  return {
    agent: { name: "adam" },
    channel: { kind },
    session: { id: sessionId },
  } as unknown as HookContext;
}

function event<TEvent>(
  type: string,
  data: Record<string, unknown>,
  at = "2026-08-12T10:00:00.000Z",
): TEvent {
  return { type, data, meta: { at, id: `evt_${type}` } } as unknown as TEvent;
}

const turnStarted = (at: string) =>
  event<HookEvent<"turn.started">>(
    "turn.started",
    { sequence: 0, turnId: "turn_0" },
    at,
  );

const turnCompleted = (at: string) =>
  event<HookEvent<"turn.completed">>(
    "turn.completed",
    { sequence: 1, turnId: "turn_0" },
    at,
  );

describe("observability handlers", () => {
  beforeEach(() => {
    vi.mocked(recordTurn).mockClear();
    vi.mocked(recordToolCall).mockClear();
    logged = new MemoryTransport();
    configureDefaultLogger({ extraTransports: [logged] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("turn duration", () => {
    it("measures a completed turn from the durable envelope", () => {
      const ctx = context("sess_1", "channel:eve");
      onTurnStarted(turnStarted("2026-08-12T10:00:00.000Z"), ctx);
      onTurnCompleted(turnCompleted("2026-08-12T10:00:03.500Z"), ctx);

      expect(recordTurn).toHaveBeenCalledWith("completed", "channel:eve", 3.5);
      expect(logged.records).toHaveLength(0);
    });

    it("still counts a turn whose start this process never saw", () => {
      onTurnCompleted(turnCompleted("2026-08-12T10:00:03.500Z"), context());

      expect(recordTurn).toHaveBeenCalledWith(
        "completed",
        "unknown",
        undefined,
      );
    });

    it("does not reuse a start across turns", () => {
      const ctx = context();
      onTurnStarted(turnStarted("2026-08-12T10:00:00.000Z"), ctx);
      onTurnCompleted(turnCompleted("2026-08-12T10:00:01.000Z"), ctx);
      onTurnCompleted(turnCompleted("2026-08-12T10:00:09.000Z"), ctx);

      expect(recordTurn).toHaveBeenNthCalledWith(1, "completed", "unknown", 1);
      expect(recordTurn).toHaveBeenNthCalledWith(
        2,
        "completed",
        "unknown",
        undefined,
      );
    });

    it("keys starts per session, not per turn id", () => {
      onTurnStarted(turnStarted("2026-08-12T10:00:00.000Z"), context("sess_a"));
      onTurnCompleted(
        turnCompleted("2026-08-12T10:00:05.000Z"),
        context("sess_b"),
      );

      expect(recordTurn).toHaveBeenCalledWith(
        "completed",
        "unknown",
        undefined,
      );
    });

    it("ignores an unparseable start timestamp", () => {
      const ctx = context();
      onTurnStarted(turnStarted("not-a-timestamp"), ctx);
      onTurnCompleted(turnCompleted("2026-08-12T10:00:01.000Z"), ctx);

      expect(recordTurn).toHaveBeenCalledWith(
        "completed",
        "unknown",
        undefined,
      );
    });

    it("ignores an unparseable end timestamp", () => {
      const ctx = context();
      onTurnStarted(turnStarted("2026-08-12T10:00:00.000Z"), ctx);
      onTurnCompleted(turnCompleted("not-a-timestamp"), ctx);

      expect(recordTurn).toHaveBeenCalledWith(
        "completed",
        "unknown",
        undefined,
      );
    });

    it("counts a cancelled turn and releases its start", () => {
      const ctx = context("sess_1", "channel:eve");
      onTurnStarted(turnStarted("2026-08-12T10:00:00.000Z"), ctx);
      onTurnCancelled(
        event<HookEvent<"turn.cancelled">>(
          "turn.cancelled",
          { sequence: 1, turnId: "turn_0" },
          "2026-08-12T10:00:02.000Z",
        ),
        ctx,
      );

      expect(recordTurn).toHaveBeenCalledWith("cancelled", "channel:eve", 2);
      // Released, so a later turn cannot inherit the entry.
      onTurnCompleted(turnCompleted("2026-08-12T10:00:30.000Z"), ctx);
      expect(recordTurn).toHaveBeenLastCalledWith(
        "completed",
        "channel:eve",
        undefined,
      );
    });

    it("evicts the oldest start once the tracking cap is reached", () => {
      const first = context("sess_first");
      onTurnStarted(turnStarted("2026-08-12T10:00:00.000Z"), first);
      for (let i = 0; i < 1_000; i += 1) {
        onTurnStarted(
          turnStarted("2026-08-12T10:00:00.000Z"),
          context(`s${i}`),
        );
      }
      onTurnCompleted(turnCompleted("2026-08-12T10:00:04.000Z"), first);

      expect(recordTurn).toHaveBeenCalledWith(
        "completed",
        "unknown",
        undefined,
      );
    });
  });

  it("logs and counts a failed turn", () => {
    onTurnFailed(
      event<HookEvent<"turn.failed">>("turn.failed", {
        code: "model_error",
        details: { provider: "openai", status: 503 },
        message: "provider refused",
        sequence: 2,
        turnId: "turn_0",
      }),
      context("sess_1", "channel:eve"),
    );

    expect(recordTurn).toHaveBeenCalledWith("failed", "channel:eve", undefined);
    expect(lastRecord()).toMatchObject({
      level: "error",
      message: "turn failed",
      event: "turn_failed",
      sessionId: "sess_1",
      turnId: "turn_0",
      channelKind: "channel:eve",
      code: "model_error",
      reason: "provider refused",
      details: { provider: "openai", status: 503 },
    });
  });

  it("warns on a step failure without counting a turn", () => {
    onStepFailed(
      event<HookEvent<"step.failed">>("step.failed", {
        code: "timeout",
        details: { attempt: 2 },
        message: "model call timed out",
        sequence: 1,
        stepIndex: 2,
        turnId: "turn_0",
      }),
      context(),
    );

    expect(recordTurn).not.toHaveBeenCalled();
    expect(lastRecord()).toMatchObject({
      level: "warn",
      message: "model step failed",
      event: "step_failed",
      sessionId: "sess_1",
      turnId: "turn_0",
      stepIndex: 2,
      code: "timeout",
      reason: "model call timed out",
      details: { attempt: 2 },
    });
  });

  it("logs a failed session", () => {
    onSessionFailed(
      event<HookEvent<"session.failed">>("session.failed", {
        code: "unrecoverable",
        details: { turnId: "turn_0" },
        message: "turn cascade",
        sessionId: "sess_1",
      }),
      context(),
    );

    expect(lastRecord()).toMatchObject({
      level: "error",
      message: "session failed",
      event: "session_failed",
      sessionId: "sess_1",
      channelKind: "unknown",
      code: "unrecoverable",
      reason: "turn cascade",
      details: { turnId: "turn_0" },
    });
  });

  it("contains a telemetry failure instead of failing the turn", () => {
    // eve turns a thrown handler into turn.failed, and one on the failure
    // cascade into session.failed.
    vi.spyOn(diag, "error").mockImplementation(() => undefined);
    vi.mocked(recordTurn).mockImplementationOnce(() => {
      throw new Error("meter provider shut down");
    });

    expect(() =>
      onTurnFailed(
        event<HookEvent<"turn.failed">>("turn.failed", {
          code: "model_error",
          message: "provider refused",
          sequence: 2,
          turnId: "turn_0",
        }),
        context(),
      ),
    ).not.toThrow();
  });

  describe("tool calls", () => {
    const toolResult = (
      status: string,
      error?: { code: string; message: string },
    ) =>
      event<HookEvent<"action.result">>("action.result", {
        error,
        result: {
          callId: "call_1",
          kind: "tool-result",
          output: {},
          toolName: "agentkit__recall_memory",
        },
        sequence: 0,
        status,
        stepIndex: 0,
        turnId: "turn_0",
      });

    it("counts a successful call without logging", () => {
      onActionResult(toolResult("completed"), context());

      expect(recordToolCall).toHaveBeenCalledWith(
        "agentkit__recall_memory",
        "completed",
      );
      expect(logged.records).toHaveLength(0);
    });

    it("counts and logs a failed call", () => {
      onActionResult(
        toolResult("failed", { code: "redis_error", message: "no connection" }),
        context(),
      );

      expect(recordToolCall).toHaveBeenCalledWith(
        "agentkit__recall_memory",
        "failed",
      );
      expect(lastRecord()).toMatchObject({
        level: "warn",
        message: "tool call failed",
        event: "tool_call_failed",
        sessionId: "sess_1",
        turnId: "turn_0",
        tool: "agentkit__recall_memory",
        status: "failed",
        code: "redis_error",
        reason: "no connection",
      });
    });

    it("ignores results that are not tool calls", () => {
      onActionResult(
        event<HookEvent<"action.result">>("action.result", {
          result: {
            callId: "call_1",
            kind: "subagent-result",
            origin: "child",
            output: {},
            subagentName: "researcher",
          },
          sequence: 0,
          status: "completed",
          stepIndex: 0,
          turnId: "turn_0",
        }),
        context(),
      );

      expect(recordToolCall).not.toHaveBeenCalled();
      expect(logged.records).toHaveLength(0);
    });
  });
});
