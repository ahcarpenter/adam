import { call } from "eve/events";
import type { HookContext, HookEvent } from "eve/hooks";
import winston from "winston";
import { neverThrow } from "./diagnostics";
import { recordToolCall, recordTurn, type TurnOutcome } from "./metrics";

// Handlers for the runtime stream events behind agent/hooks/observability.ts,
// kept out of the hook file so they are unit-testable.
//
// Every handler body runs inside neverThrow. A hook that throws fails the
// running turn, so without it a logging or metric call that fails would end
// the turn it was only meant to describe.
//
// Failure lines carry eve's error `code`, `message` and `errorId`. The
// message is written by whatever failed and can quote model input or a tool
// payload, which makes PostHog Logs another store holding message content —
// the same categories the trace policy in agent/instrumentation/otel.ts
// already sends to Braintrust and PostHog.

/**
 * Cap on in-flight turn start times. A turn whose start was observed in a
 * different worker process, or evicted here, still gets counted — it just
 * contributes no duration sample.
 */
const maxTrackedTurns = 1_000;

const turnStartedAt = new Map<string, number>();

function trackKey(sessionId: string, turnId: string): string {
  // turnId is only unique within its session, so it collides across
  // sessions on its own.
  return `${sessionId}:${turnId}`;
}

function channelKind(ctx: HookContext): string {
  return ctx.channel.kind ?? "unknown";
}

/**
 * Duration between two stream events, from the times eve recorded them
 * rather than a local clock: the two events can be handled by different
 * processes.
 */
function takeDurationSeconds(key: string, endedAt: Date): number | undefined {
  const startedAt = turnStartedAt.get(key);
  if (startedAt === undefined) return undefined;
  turnStartedAt.delete(key);

  const ended = endedAt.getTime();
  return Number.isNaN(ended) ? undefined : (ended - startedAt) / 1_000;
}

export function onTurnStarted(
  event: HookEvent<"turn.started">,
  ctx: HookContext,
): void {
  neverThrow("turn.started instrumentation", () => {
    const startedAt = ctx.now.getTime();
    if (Number.isNaN(startedAt)) return;

    if (turnStartedAt.size >= maxTrackedTurns) {
      // Map iteration is insertion-ordered, so this drops the oldest entry.
      const oldest = turnStartedAt.keys().next();
      if (!oldest.done) turnStartedAt.delete(oldest.value);
    }
    turnStartedAt.set(trackKey(ctx.session.id, event.data.turnId), startedAt);
  });
}

/**
 * Every way a turn ends. Cancellation is a third outcome, not a failure and
 * not a success, and it still has to release the turn's start, or a
 * cancel-heavy workload would evict live turns from the map and silently
 * thin out the duration histogram. A successful turn leaves no log line: its
 * trace describes it fully.
 */
export function onTurnSettled(
  event: HookEvent<"turn.settled">,
  ctx: HookContext,
): void {
  neverThrow("turn.settled instrumentation", () => {
    const { turnId, error } = event.data;
    const outcome: TurnOutcome = event.data.outcome;
    const seconds = takeDurationSeconds(
      trackKey(ctx.session.id, turnId),
      ctx.now,
    );
    recordTurn(outcome, channelKind(ctx), seconds);
    if (outcome !== "failed") return;

    winston.error("turn failed", {
      event: "turn_failed",
      sessionId: ctx.session.id,
      turnId,
      channelKind: channelKind(ctx),
      code: error?.code,
      reason: error?.message,
      errorId: error?.id,
    });
  });
}

/**
 * A failed model attempt that eve runs again is degraded-but-handled: a
 * trend to watch rather than an incident. A run that gives up fails its turn,
 * which `turn_failed` above reports.
 */
export function onModelRetried(
  event: HookEvent<"model.retried">,
  ctx: HookContext,
): void {
  neverThrow("model.retried instrumentation", () => {
    const { runId, attempt, error } = event.data;
    winston.warn("model attempt failed", {
      event: "model_attempt_failed",
      sessionId: ctx.session.id,
      turnId: event.scope?.turnId,
      runId,
      attempt,
      code: error.code,
      reason: error.message,
      errorId: error.id,
    });
  });
}

/**
 * A model run that gave up: its last attempt failed and eve will not retry
 * it. The turn it belonged to fails as well and `turn_failed` reports that;
 * this line keeps the model's own error, which the turn's may not carry.
 */
export function onModelSettled(
  event: HookEvent<"model.settled">,
  ctx: HookContext,
): void {
  neverThrow("model.settled instrumentation", () => {
    const { runId, outcome, error } = event.data;
    if (outcome !== "failed") return;

    winston.warn("model run failed", {
      event: "model_failed",
      sessionId: ctx.session.id,
      turnId: event.scope?.turnId,
      runId,
      code: error?.code,
      reason: error?.message,
      errorId: error?.id,
    });
  });
}

/**
 * The session itself failed, not one turn: no later message reaches it.
 */
export function onSessionEnded(
  event: HookEvent<"session.ended">,
  ctx: HookContext,
): void {
  neverThrow("session.ended instrumentation", () => {
    const { outcome, error } = event.data;
    if (outcome !== "failed") return;

    winston.error("session failed", {
      event: "session_failed",
      sessionId: ctx.session.id,
      channelKind: channelKind(ctx),
      code: error?.code,
      reason: error?.message,
      errorId: error?.id,
    });
  });
}

/**
 * Tool calls only. A call can also run a subagent, load a skill or manage
 * the model's own background tasks; none of those is a tool, and the metric
 * would stop meaning "tool calls" if they were counted.
 */
export function onCallSettled(
  event: HookEvent<"call.settled">,
  ctx: HookContext,
): void {
  neverThrow("call.settled instrumentation", () => {
    const observed = call(ctx.view, event.data.callId);
    if (observed?.kind !== "tool") return;

    const { outcome, error } = event.data;
    recordToolCall(observed.name, outcome);
    if (outcome === "completed") return;

    winston.warn("tool call failed", {
      event: "tool_call_failed",
      sessionId: ctx.session.id,
      turnId: observed.turnId,
      tool: observed.name,
      status: outcome,
      code: error?.code,
      reason: error?.message,
    });
  });
}
