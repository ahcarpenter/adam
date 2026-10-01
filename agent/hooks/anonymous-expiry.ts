import { defineHook } from "eve/hooks";
import { onAnonymousTurnEnded } from "#lib/anonymous-expiry";
import { ensureLogger } from "#lib/logger";

ensureLogger();

// Expires an anonymous session's AgentKit memory and chat history 24 hours
// after its last turn; see agent/lib/anonymous-expiry.ts. Subscribed to
// every way a turn ends, so a failed or cancelled turn's writes are covered
// too.
export default defineHook({
  events: {
    "turn.cancelled": onAnonymousTurnEnded,
    "turn.completed": onAnonymousTurnEnded,
    "turn.failed": onAnonymousTurnEnded,
  },
});
