import { describe, expect, it } from "vitest";
import { agentkitUserId } from "./agentkit-user";

// The principal eve's none() returns for every caller it accepts.
const anonymous = {
  attributes: {},
  authenticator: "none",
  principalId: "anonymous",
  principalType: "anonymous",
};

function principal(principalId: string, principalType = "user") {
  return { attributes: {}, authenticator: "test", principalId, principalType };
}

function session(
  id: string,
  auth: Parameters<typeof agentkitUserId>[0]["session"]["auth"],
) {
  return { session: { id, auth } };
}

describe("agentkitUserId", () => {
  it("keys two anonymous sessions apart, by their session ids", () => {
    const first = agentkitUserId(
      session("session-a", { current: anonymous, initiator: anonymous }),
    );
    const second = agentkitUserId(
      session("session-b", { current: anonymous, initiator: anonymous }),
    );
    expect(first).toBe("session-a");
    expect(second).toBe("session-b");
  });

  it("keys a named caller by principal id, whatever the session", () => {
    const user = principal("https://issuer.example:user-7");
    expect(
      agentkitUserId(session("session-a", { current: user, initiator: user })),
    ).toBe("https://issuer.example:user-7");
    expect(
      agentkitUserId(session("session-b", { current: user, initiator: user })),
    ).toBe("https://issuer.example:user-7");
  });

  it("does not hand a named initiator's key to an anonymous follow-up", () => {
    expect(
      agentkitUserId(
        session("session-a", {
          current: anonymous,
          initiator: principal("user-7"),
        }),
      ),
    ).toBe("session-a");
  });

  it("keys a named caller following up on an anonymous session by principal id", () => {
    expect(
      agentkitUserId(
        session("session-a", {
          current: principal("user-7"),
          initiator: anonymous,
        }),
      ),
    ).toBe("user-7");
  });

  it("falls back to the initiator when the turn has no caller", () => {
    expect(
      agentkitUserId(
        session("session-a", {
          current: null,
          initiator: principal("user-7"),
        }),
      ),
    ).toBe("user-7");
  });

  it("keys a callerless turn on an anonymous session by session id", () => {
    expect(
      agentkitUserId(
        session("session-a", { current: null, initiator: anonymous }),
      ),
    ).toBe("session-a");
  });

  it("keys a session with no caller at all by session id", () => {
    expect(
      agentkitUserId(session("session-a", { current: null, initiator: null })),
    ).toBe("session-a");
  });

  // Not anonymous, so unchanged from AgentKit's default: these principals
  // are shared by design of the authenticator that issues them.
  it.each([
    ["service", "https://oidc.vercel.com/team:owner:team:project:adam"],
    ["runtime", "eve:app"],
    ["local-dev", "local-dev"],
  ])("keeps a %s principal on its principal id", (principalType, id) => {
    const caller = principal(id, principalType);
    expect(
      agentkitUserId(
        session("session-a", { current: caller, initiator: caller }),
      ),
    ).toBe(id);
  });
});
