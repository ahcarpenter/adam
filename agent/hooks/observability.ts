import { defineHook } from "eve/hooks";
import winston from "winston";
import { ensureLogger } from "../lib/logger";

// Hooks run in their own worker, so bootstrap the logger here rather than
// relying on instrumentation.ts having run in this process.
ensureLogger();

// Structured lifecycle logging: JSON console + OTel bridge to PostHog.
// Observe-only; never affects the turn.
export default defineHook({
  events: {
    "session.started"(_event, ctx) {
      winston.info("session started", {
        sessionId: ctx.session.id,
        channel: ctx.channel.kind,
      });
    },
    "turn.started"(event, ctx) {
      winston.info("turn started", {
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
      });
    },
    "turn.completed"(event, ctx) {
      winston.info("turn completed", {
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
      });
    },
    "turn.failed"(event, ctx) {
      winston.error("turn failed", {
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
        code: event.data.code,
        error: event.data.message,
      });
    },
    "session.failed"(event, ctx) {
      winston.error("session failed", {
        sessionId: ctx.session.id,
        code: event.data.code,
        error: event.data.message,
      });
    },
    "action.result"(event, ctx) {
      const result = event.data.result;
      const toolName =
        "toolName" in result
          ? result.toolName
          : "subagentName" in result
            ? result.subagentName
            : result.name;
      winston.info("tool result", {
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
        toolName,
        status: event.data.status,
      });
    },
  },
});
