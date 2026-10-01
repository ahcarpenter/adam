import type { SessionContext } from "eve/tools";

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
 * session's initiator standing in when a turn has no caller of its own. An
 * anonymous follow-up on a session a named user started is therefore keyed
 * by the session too: eve does not enforce session ownership, so knowing a
 * session id must not be enough to read its initiator's memory.
 *
 * Only anonymous callers change. Any other principal keeps its principal id,
 * including the ones several callers share: Vercel team members reach
 * production through vercelOidc() as one `service` principal, and local
 * development is the single `local-dev` principal.
 */
export function agentkitUserId(ctx: {
  session: Pick<SessionContext["session"], "id" | "auth">;
}): string {
  const { id, auth } = ctx.session;
  const caller = auth.current ?? auth.initiator;
  if (!caller || caller.principalType === "anonymous") return id;
  return caller.principalId;
}
