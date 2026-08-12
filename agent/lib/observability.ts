import type { HookContext, HookEvent } from "eve/hooks";
import winston from "winston";
import { neverThrow } from "./diagnostics";
import { recordToolCall, recordTurn, type TurnOutcome } from "./metrics";

// Handlers for the runtime stream events behind agent/hooks/observability.ts,
// kept out of the hook file so they are unit-testable.
//
// Every handler body runs inside neverThrow: eve turns a thrown hook into
// `turn.failed`, and one subscribed to a failure-cascade event into
// `session.failed`, so an unguarded logging call could end the session it was
// only meant to describe.
//
// Failure `details` is logged. It is shaped by whatever failed and can carry
// model input or tool payloads, which makes PostHog Logs another store
// holding message content — the same categories `recordInputs`/
// `recordOutputs` already send to Braintrust and PostHog traces.

/**
 * Cap on in-flight turn start times. A turn whose start was observed in a
 * different worker process, or evicted here, still gets counted — it just
 * contributes no duration sample.
 */
const maxTrackedTurns = 1_000;

const turnStartedAt = new Map<string, number>();

function trackKey(sessionId: string, turnId: string): string {
  // turnId is a per-session sequence (`turn_0`), so it collides across
  // sessions on its own.
  return `${sessionId}:${turnId}`;
}

function channelKind(ctx: HookContext): string {
  return ctx.channel.kind ?? "unknown";
}

/**
 * Duration between two stream events, from the durable envelope rather than
 * a local clock: the two events can be emitted by different processes.
 */
function takeDurationSeconds(key: string, endedAt: string): number | undefined {
  const startedAt = turnStartedAt.get(key);
  if (startedAt === undefined) return undefined;
  turnStartedAt.delete(key);

  const ended = Date.parse(endedAt);
  return Number.isNaN(ended) ? undefined : (ended - startedAt) / 1_000;
}

/**
 * Ends a turn's tracking. Every terminal outcome routes through here —
 * including cancellation, which is not a failure but still has to release
 * the entry, or a cancel-heavy workload would evict live turns from the map
 * and silently thin out the duration histogram.
 */
function completeTurn(
  outcome: TurnOutcome,
  turnId: string,
  endedAt: string,
  ctx: HookContext,
): void {
  const seconds = takeDurationSeconds(
    trackKey(ctx.session.id, turnId),
    endedAt,
  );
  recordTurn(outcome, channelKind(ctx), seconds);
}

export function onTurnStarted(
  event: HookEvent<"turn.started">,
  ctx: HookContext,
): void {
  neverThrow("turn.started instrumentation", () => {
    const startedAt = Date.parse(event.meta.at);
    if (Number.isNaN(startedAt)) return;

    if (turnStartedAt.size >= maxTrackedTurns) {
      // Map iteration is insertion-ordered, so this drops the oldest entry.
      const oldest = turnStartedAt.keys().next();
      if (!oldest.done) turnStartedAt.delete(oldest.value);
    }
    turnStartedAt.set(trackKey(ctx.session.id, event.data.turnId), startedAt);
  });
}

export function onTurnCompleted(
  event: HookEvent<"turn.completed">,
  ctx: HookContext,
): void {
  // No log line: a successful turn is fully described by its trace.
  neverThrow("turn.completed instrumentation", () => {
    completeTurn("completed", event.data.turnId, event.meta.at, ctx);
  });
}

/**
 * Cancellation is a third outcome, not a failure and not a success: the turn
 * ends without `turn.failed`, `session.waiting` follows, and the session
 * carries on. Counting it keeps the turn rate honest.
 */
export function onTurnCancelled(
  event: HookEvent<"turn.cancelled">,
  ctx: HookContext,
): void {
  neverThrow("turn.cancelled instrumentation", () => {
    completeTurn("cancelled", event.data.turnId, event.meta.at, ctx);
  });
}

export function onTurnFailed(
  event: HookEvent<"turn.failed">,
  ctx: HookContext,
): void {
  neverThrow("turn.failed instrumentation", () => {
    completeTurn("failed", event.data.turnId, event.meta.at, ctx);
    winston.error("turn failed", {
      event: "turn_failed",
      sessionId: ctx.session.id,
      turnId: event.data.turnId,
      channelKind: channelKind(ctx),
      code: event.data.code,
      reason: event.data.message,
      details: event.data.details,
    });
  });
}

/**
 * A step failure is degraded-but-handled: eve retries a durable step up to
 * four times, so this is a trend to watch rather than an incident. The turn
 * that gives up emits `turn.failed` above.
 */
export function onStepFailed(
  event: HookEvent<"step.failed">,
  ctx: HookContext,
): void {
  neverThrow("step.failed instrumentation", () => {
    winston.warn("model step failed", {
      event: "step_failed",
      sessionId: ctx.session.id,
      turnId: event.data.turnId,
      stepIndex: event.data.stepIndex,
      code: event.data.code,
      reason: event.data.message,
      details: event.data.details,
    });
  });
}

export function onSessionFailed(
  event: HookEvent<"session.failed">,
  ctx: HookContext,
): void {
  neverThrow("session.failed instrumentation", () => {
    winston.error("session failed", {
      event: "session_failed",
      sessionId: ctx.session.id,
      channelKind: channelKind(ctx),
      code: event.data.code,
      reason: event.data.message,
      details: event.data.details,
    });
  });
}

export function onActionResult(
  event: HookEvent<"action.result">,
  ctx: HookContext,
): void {
  neverThrow("action.result instrumentation", () => {
    const { error, result, status } = event.data;
    if (result.kind !== "tool-result") return;

    recordToolCall(result.toolName, status);
    if (status === "completed") return;

    winston.warn("tool call failed", {
      event: "tool_call_failed",
      sessionId: ctx.session.id,
      turnId: event.data.turnId,
      tool: result.toolName,
      status,
      code: error?.code,
      reason: error?.message,
    });
  });
}
