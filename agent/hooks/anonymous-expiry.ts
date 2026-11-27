import { defineHook } from "eve/hooks";
import { onAnonymousTurnEnded } from "#lib/anonymous-expiry";
import { ensureLogger } from "#lib/logger";

ensureLogger();

// Expires an anonymous session's AgentKit memory and chat history 24 hours
// after its last turn; see agent/lib/anonymous-expiry.ts. eve records every
// way a turn ends, including failing or being cancelled, as turn.settled, so
// a failed or cancelled turn's writes are covered too.
export default defineHook({
  events: {
    "turn.settled": onAnonymousTurnEnded,
  },
});
