import { defineHook } from "eve/hooks";
import { ensureLogger } from "#lib/logger";
import { ensureMetrics } from "#lib/metrics";
import {
  onCallSettled,
  onModelRetried,
  onModelSettled,
  onSessionEnded,
  onTurnSettled,
  onTurnStarted,
} from "#lib/observability";

// This worker emits both signals, so it bootstraps both pipelines.
ensureLogger();
ensureMetrics();

// The questions this hook exists to answer are listed in
// docs/observability.md. Successful turns are left to the traces; what is
// here is the failure and throughput evidence that traces cannot answer in
// aggregate, plus the rejections that never reach a trace at all
// (agent/lib/observed-auth.ts).
export default defineHook({
  events: {
    "call.settled": onCallSettled,
    "model.retried": onModelRetried,
    "model.settled": onModelSettled,
    "session.ended": onSessionEnded,
    "turn.settled": onTurnSettled,
    "turn.started": onTurnStarted,
  },
});
