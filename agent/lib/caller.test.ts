import { describe, expect, it } from "vitest";
import { identifiedCaller } from "./caller";

// The principal eve's none() returns for every caller it accepts.
const anonymous = {
  attributes: {},
  authenticator: "none",
  principalId: "anonymous",
  principalType: "anonymous",
};

const user = {
  attributes: {},
  authenticator: "vercel-sign-in",
  principalId: "https://vercel.com:user_1",
  principalType: "user",
};

describe("identifiedCaller", () => {
  it("is the caller of the active turn", () => {
    expect(identifiedCaller({ current: user, initiator: user })).toBe(user);
  });

  it("is a named caller following up on an anonymous session", () => {
    expect(identifiedCaller({ current: user, initiator: anonymous })).toBe(
      user,
    );
  });

  it("is the initiator when the turn has no caller of its own", () => {
    expect(identifiedCaller({ current: null, initiator: user })).toBe(user);
  });

  // Not anonymous, so identified: these principals are shared by design of
  // the authenticator that issues them, and every one of them has been let
  // in by something other than none().
  it.each(["service", "runtime", "local-dev"])(
    "is a %s principal",
    (principalType) => {
      const caller = { ...user, principalType };

      expect(identifiedCaller({ current: caller, initiator: caller })).toBe(
        caller,
      );
    },
  );

  describe("is nobody", () => {
    it("for an anonymous caller", () => {
      expect(
        identifiedCaller({ current: anonymous, initiator: anonymous }),
      ).toBeNull();
    });

    // eve does not enforce session ownership: knowing a session id must not
    // be enough to act as the user who started it.
    it("for an anonymous follow-up on a named user's session", () => {
      expect(
        identifiedCaller({ current: anonymous, initiator: user }),
      ).toBeNull();
    });

    it("for a callerless turn on an anonymous session", () => {
      expect(
        identifiedCaller({ current: null, initiator: anonymous }),
      ).toBeNull();
    });

    it("for a session with no caller at all", () => {
      expect(identifiedCaller({ current: null, initiator: null })).toBeNull();
    });
  });
});
