import type { SessionContext } from "eve/tools";
import { identifiedCaller } from "./caller";

/**
 * The user AgentKit keys memory and chat history by.
 *
 * AgentKit's own default is the caller's principal id, then the session id.
 * That breaks under eve's none(): every anonymous caller carries the same
 * principal id, the literal `anonymous`, so they would all share one memory
 * and one chat history, and a fact one visitor saved would be recalled for
 * the next. An anonymous caller has no identity that outlives the session,
 * so the session is the only boundary that separates one from another.
 *
 * The caller of the active turn decides, as in AgentKit's default, with the
 * session's initiator standing in when a turn has no caller of its own; see
 * agent/lib/caller.ts. An anonymous follow-up on a session a named user
 * started is therefore keyed by the session too, so knowing a session id is
 * not enough to read its initiator's memory.
 *
 * Only anonymous callers change. Any other principal keeps its principal id.
 * A caller who signed in with Vercel (agent/lib/vercel-sign-in.ts) is a
 * `user` whose principal id carries their own Vercel user id, so each has
 * their own memory and chat history. Two principals are still shared by
 * several callers: Vercel team members who reach production through
 * vercelOidc() rather than signing in arrive as one `service` principal,
 * because that token names the project and no person, and local development
 * is the single `local-dev` principal.
 */
export function agentkitUserId(ctx: {
  session: Pick<SessionContext["session"], "id" | "auth">;
}): string {
  const { id, auth } = ctx.session;
  return identifiedCaller(auth)?.principalId ?? id;
}
