import type { SessionContext } from "eve/tools";

type SessionAuth = SessionContext["session"]["auth"];

/**
 * The caller a turn acts for, when that caller has an identity; `null` for
 * an anonymous caller and for a turn with no caller at all.
 *
 * The caller of the active turn decides, with the session's initiator
 * standing in when a turn has no caller of its own. An anonymous follow-up
 * on a session a named user started is therefore not that user: eve does not
 * enforce session ownership, so knowing a session id must not be enough to
 * act as its initiator.
 *
 * The key AgentKit stores memory and chat history under goes through this
 * rule (agent/lib/agentkit-user.ts).
 */
export function identifiedCaller(
  auth: SessionAuth,
): NonNullable<SessionAuth["current"]> | null {
  const caller = auth.current ?? auth.initiator;
  if (!caller || caller.principalType === "anonymous") return null;
  return caller;
}
