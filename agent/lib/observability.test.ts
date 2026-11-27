import { emptySessionView, foldEvents, type SessionView } from "eve/events";
import type { HookContext, HookEvent, HookEventType } from "eve/hooks";
import { describe, expect, it, vi } from "vitest";
import TransportStream from "winston-transport";

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

/**
 * Fresh module instance per test. The handlers track in-flight turns in
 * module state, so without this the eviction case would leave a thousand
 * entries behind and every later case would depend on test order.
 */
async function load() {
  vi.resetModules();
  // resetModules gives a fresh observability module, but vitest keeps the
  // mocked one, so its call history has to be cleared separately.
  vi.clearAllMocks();
  const observability = await import("./observability");
  const metrics = await import("./metrics");
  const { diag } = await import("@opentelemetry/api");
  const { configureDefaultLogger } = await import("./logger");

  const logged = new MemoryTransport();
  configureDefaultLogger({ extraTransports: [logged] });

  return {
    ...observability,
    diag,
    logged,
    lastRecord() {
      const record = logged.records.at(-1);
      if (!record) throw new Error("no log records captured");
      return record;
    },
    recordToolCall: vi.mocked(metrics.recordToolCall),
    recordTurn: vi.mocked(metrics.recordTurn),
  };
}

// The handlers read session.id, channel.kind, now and view off the hook
// context.
function context(
  input: {
    sessionId?: string;
    kind?: string;
    at?: string;
    view?: SessionView;
  } = {},
): HookContext {
  return {
    agent: { name: "adam" },
    channel: { kind: input.kind },
    session: { id: input.sessionId ?? "sess_1" },
    now: new Date(input.at ?? "2026-08-12T10:00:00.000Z"),
    view: input.view ?? emptySessionView(),
  } as unknown as HookContext;
}

function event<K extends HookEventType>(
  type: K,
  data: Record<string, unknown>,
  scope?: Record<string, string>,
): HookEvent<K> {
  return { type, data, scope } as unknown as HookEvent<K>;
}

const turnStarted = () =>
  event("turn.started", {
    cause: { deliveryId: "dlv_0" },
    follows: null,
    turnId: "turn_0",
  });

const turnSettled = (outcome: string, error?: Record<string, unknown>) =>
  event("turn.settled", { error, outcome, turnId: "turn_0" });

describe("observability handlers", () => {
  describe("turn duration", () => {
    it("measures a completed turn from the times eve recorded", async () => {
      const { onTurnStarted, onTurnSettled, recordTurn, logged } = await load();
      onTurnStarted(
        turnStarted(),
        context({ kind: "channel:eve", at: "2026-08-12T10:00:00.000Z" }),
      );
      onTurnSettled(
        turnSettled("completed"),
        context({ kind: "channel:eve", at: "2026-08-12T10:00:03.500Z" }),
      );

      expect(recordTurn).toHaveBeenCalledWith("completed", "channel:eve", 3.5);
      expect(logged.records).toHaveLength(0);
    });

    it("still counts a turn whose start this process never saw", async () => {
      const { onTurnSettled, recordTurn } = await load();
      onTurnSettled(turnSettled("completed"), context());

      expect(recordTurn).toHaveBeenCalledWith(
        "completed",
        "unknown",
        undefined,
      );
    });

    it("does not reuse a start across turns", async () => {
      const { onTurnStarted, onTurnSettled, recordTurn } = await load();
      onTurnStarted(turnStarted(), context({ at: "2026-08-12T10:00:00.000Z" }));
      onTurnSettled(
        turnSettled("completed"),
        context({ at: "2026-08-12T10:00:01.000Z" }),
      );
      onTurnSettled(
        turnSettled("completed"),
        context({ at: "2026-08-12T10:00:09.000Z" }),
      );

      expect(recordTurn).toHaveBeenNthCalledWith(1, "completed", "unknown", 1);
      expect(recordTurn).toHaveBeenNthCalledWith(
        2,
        "completed",
        "unknown",
        undefined,
      );
    });

    it("keys starts per session, not per turn id", async () => {
      const { onTurnStarted, onTurnSettled, recordTurn } = await load();
      onTurnStarted(turnStarted(), context({ sessionId: "sess_a" }));
      onTurnSettled(
        turnSettled("completed"),
        context({ sessionId: "sess_b", at: "2026-08-12T10:00:05.000Z" }),
      );

      expect(recordTurn).toHaveBeenCalledWith(
        "completed",
        "unknown",
        undefined,
      );
    });

    it("ignores an invalid start time", async () => {
      const { onTurnStarted, onTurnSettled, recordTurn } = await load();
      onTurnStarted(turnStarted(), context({ at: "not-a-timestamp" }));
      onTurnSettled(
        turnSettled("completed"),
        context({ at: "2026-08-12T10:00:01.000Z" }),
      );

      expect(recordTurn).toHaveBeenCalledWith(
        "completed",
        "unknown",
        undefined,
      );
    });

    it("ignores an invalid end time", async () => {
      const { onTurnStarted, onTurnSettled, recordTurn } = await load();
      onTurnStarted(turnStarted(), context({ at: "2026-08-12T10:00:00.000Z" }));
      onTurnSettled(
        turnSettled("completed"),
        context({ at: "not-a-timestamp" }),
      );

      expect(recordTurn).toHaveBeenCalledWith(
        "completed",
        "unknown",
        undefined,
      );
    });

    it("counts a cancelled turn and releases its start", async () => {
      const { onTurnStarted, onTurnSettled, recordTurn, logged } = await load();
      onTurnStarted(
        turnStarted(),
        context({ kind: "channel:eve", at: "2026-08-12T10:00:00.000Z" }),
      );
      onTurnSettled(
        turnSettled("cancelled"),
        context({ kind: "channel:eve", at: "2026-08-12T10:00:02.000Z" }),
      );

      expect(recordTurn).toHaveBeenCalledWith("cancelled", "channel:eve", 2);
      expect(logged.records).toHaveLength(0);
      // Released, so a later turn cannot inherit the entry.
      onTurnSettled(
        turnSettled("completed"),
        context({ kind: "channel:eve", at: "2026-08-12T10:00:30.000Z" }),
      );
      expect(recordTurn).toHaveBeenLastCalledWith(
        "completed",
        "channel:eve",
        undefined,
      );
    });

    it("evicts the oldest start once the tracking cap is reached", async () => {
      const { onTurnStarted, onTurnSettled, recordTurn } = await load();
      onTurnStarted(turnStarted(), context({ sessionId: "sess_first" }));
      for (let i = 0; i < 1_000; i += 1) {
        onTurnStarted(turnStarted(), context({ sessionId: `s${i}` }));
      }
      onTurnSettled(
        turnSettled("completed"),
        context({ sessionId: "sess_first", at: "2026-08-12T10:00:04.000Z" }),
      );

      expect(recordTurn).toHaveBeenCalledWith(
        "completed",
        "unknown",
        undefined,
      );
    });
  });

  it("logs and counts a failed turn", async () => {
    const { onTurnSettled, recordTurn, lastRecord } = await load();
    onTurnSettled(
      turnSettled("failed", {
        code: "model_error",
        id: "err_1",
        message: "provider refused",
      }),
      context({ kind: "channel:eve" }),
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
      errorId: "err_1",
    });
  });

  it("warns on a model attempt eve retries, without counting a turn", async () => {
    const { onModelRetried, recordTurn, lastRecord } = await load();
    onModelRetried(
      event(
        "model.retried",
        {
          attempt: 1,
          error: { code: "timeout", id: "err_2", message: "timed out" },
          runId: "run_0",
        },
        { runId: "run_0", turnId: "turn_0" },
      ),
      context(),
    );

    expect(recordTurn).not.toHaveBeenCalled();
    expect(lastRecord()).toMatchObject({
      level: "warn",
      message: "model attempt failed",
      event: "model_attempt_failed",
      sessionId: "sess_1",
      turnId: "turn_0",
      runId: "run_0",
      attempt: 1,
      code: "timeout",
      reason: "timed out",
      errorId: "err_2",
    });
  });

  it("warns on a model run that gave up", async () => {
    const { onModelSettled, recordTurn, lastRecord } = await load();
    onModelSettled(
      event(
        "model.settled",
        {
          error: { code: "provider_error", id: "err_3", message: "refused" },
          outcome: "failed",
          runId: "run_0",
        },
        { runId: "run_0", turnId: "turn_0" },
      ),
      context(),
    );

    expect(recordTurn).not.toHaveBeenCalled();
    expect(lastRecord()).toMatchObject({
      level: "warn",
      message: "model run failed",
      event: "model_failed",
      sessionId: "sess_1",
      turnId: "turn_0",
      runId: "run_0",
      code: "provider_error",
      reason: "refused",
      errorId: "err_3",
    });
  });

  it("logs nothing for a model run that did not fail", async () => {
    const { onModelSettled, logged } = await load();
    for (const outcome of ["completed", "interrupted", "abandoned"]) {
      onModelSettled(
        event("model.settled", { outcome, runId: "run_0" }),
        context(),
      );
    }

    expect(logged.records).toHaveLength(0);
  });

  it("logs a failed session", async () => {
    const { onSessionEnded, lastRecord } = await load();
    onSessionEnded(
      event("session.ended", {
        cause: { turnId: "turn_0" },
        error: { code: "unrecoverable", message: "turn cascade" },
        outcome: "failed",
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
    });
  });

  it("logs nothing for a session that ends normally", async () => {
    const { onSessionEnded, logged } = await load();
    onSessionEnded(event("session.ended", { outcome: "completed" }), context());

    expect(logged.records).toHaveLength(0);
  });

  it("contains a telemetry failure inside the handler", async () => {
    // A hook that throws fails the running turn, so neverThrow is what keeps
    // a failing meter from ending the turn it describes.
    const { onTurnSettled, recordTurn, diag } = await load();
    const diagError = vi
      .spyOn(diag, "error")
      .mockImplementation(() => undefined);
    recordTurn.mockImplementationOnce(() => {
      throw new Error("meter provider shut down");
    });

    expect(() =>
      onTurnSettled(
        turnSettled("failed", { code: "model_error", message: "refused" }),
        context(),
      ),
    ).not.toThrow();
    expect(diagError).toHaveBeenCalledOnce();
    diagError.mockRestore();
  });

  describe("tool calls", () => {
    /**
     * A session view in which the model requested one tool call and one
     * subagent call, folded by eve itself, as eve hands a hook its view.
     */
    function requested(): SessionView {
      const at = "2026-08-12T10:00:00.000Z";
      const requests = [
        {
          callId: "call_1",
          capability: { kind: "tool", name: "agentkit__recall_memory" },
        },
        { callId: "call_2", capability: { kind: "agent", name: "researcher" } },
      ];
      return foldEvents(
        emptySessionView(),
        requests.map(({ callId, capability }, index) => ({
          type: "call.requested",
          data: { callId, capability, input: {}, owner: { turnId: "turn_0" } },
          scope: { turnId: "turn_0" },
          meta: { at, position: { line: 0, index } },
        })),
      );
    }

    const settled = (
      callId: string,
      outcome: string,
      error?: { code: string; message: string },
    ) => event("call.settled", { callId, error, outcome });

    it("counts a successful call without logging", async () => {
      const { onCallSettled, recordToolCall, logged } = await load();
      onCallSettled(
        settled("call_1", "completed"),
        context({ view: requested() }),
      );

      expect(recordToolCall).toHaveBeenCalledWith(
        "agentkit__recall_memory",
        "completed",
      );
      expect(logged.records).toHaveLength(0);
    });

    it("counts and logs a failed call", async () => {
      const { onCallSettled, recordToolCall, lastRecord } = await load();
      onCallSettled(
        settled("call_1", "failed", {
          code: "redis_error",
          message: "no connection",
        }),
        context({ view: requested() }),
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

    it("ignores calls that are not tool calls", async () => {
      const { onCallSettled, recordToolCall, logged } = await load();
      onCallSettled(
        settled("call_2", "completed"),
        context({ view: requested() }),
      );

      expect(recordToolCall).not.toHaveBeenCalled();
      expect(logged.records).toHaveLength(0);
    });

    it("ignores a call the view does not hold", async () => {
      const { onCallSettled, recordToolCall } = await load();
      onCallSettled(settled("call_9", "failed"), context());

      expect(recordToolCall).not.toHaveBeenCalled();
    });
  });
});
