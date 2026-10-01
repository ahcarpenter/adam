import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import winston from "winston";
import {
  anonymousRetentionSeconds,
  expireAnonymousSession,
  onAnonymousTurnEnded,
} from "./anonymous-expiry";
import { validEnv } from "./env.fixtures";

// These tests read the commands adam sends to Upstash, over a stand-in for
// its REST endpoint that holds a small keyspace. They cannot show what a
// real database then does with an expiry: whether a later rewrite of the
// document keeps it, or whether the search index drops an expired memory.

type Command = (string | number)[];

/** Redis glob to RegExp, honoring `\` escapes as SCAN's MATCH does. */
function glob(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] as string;
    if (char === "\\") source += `\\${pattern[++i]}`;
    else if (char === "*") source += ".*";
    else if (char === "?") source += ".";
    else source += char.replace(/[.+^${}()|[\]]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

const base64 = (value: string) => Buffer.from(value).toString("base64");

/**
 * Stands in for Upstash's REST endpoint: answers SCAN over `keyspace` two
 * keys a page, as base64 the way Upstash does, and records everything sent.
 */
function stubUpstash(keyspace: string[]) {
  const commands: Command[] = [];
  const answer = (command: Command) => {
    commands.push(command);
    if (String(command[0]).toUpperCase() !== "SCAN") return { result: 1 };
    const start = Number(command[1]);
    const matching = keyspace.filter((key) =>
      glob(String(command[3])).test(key),
    );
    const next = start + 2 < matching.length ? String(start + 2) : "0";
    return {
      result: [base64(next), matching.slice(start, start + 2).map(base64)],
    };
  };
  vi.stubGlobal("fetch", async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as Command | Command[];
    return Response.json(
      Array.isArray(body[0])
        ? (body as Command[]).map(answer)
        : answer(body as Command),
    );
  });
  return {
    commands,
    /** Each key given an expiry, with the seconds it was given. */
    expiries: () =>
      Object.fromEntries(
        commands
          .filter(([name]) => String(name).toUpperCase() === "EXPIRE")
          .map(([, key, seconds]) => [key, seconds]),
      ),
  };
}

// What eve's none() returns for every caller it accepts.
const anonymous = {
  attributes: {},
  authenticator: "none",
  principalId: "anonymous",
  principalType: "anonymous",
};

function principal(principalId: string, principalType: string) {
  return { attributes: {}, authenticator: "test", principalId, principalType };
}

type Auth = Parameters<typeof expireAnonymousSession>[0]["session"]["auth"];

function session(id: string, auth: Partial<Auth>) {
  return { session: { id, auth: auth as Auth } } as Parameters<
    typeof expireAnonymousSession
  >[0];
}

const keyspace = [
  "agentkit:chat:session-a:session-a",
  "agentkit:memory:session-a:m1",
  "agentkit:memory:session-a:m2",
  "agentkit:memory:session-a:m3",
  // Everything below belongs to someone else.
  "agentkit:chat:session-b:session-b",
  "agentkit:memory:session-b:m1",
  "agentkit:memory:session-ab:m1",
  "agentkit:chat:user-7:session-a",
  "agentkit:memory:user-7:m1",
  "documents:1",
];

beforeEach(() => {
  for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("expireAnonymousSession", () => {
  it("is a 24-hour retention", () => {
    expect(anonymousRetentionSeconds).toBe(86_400);
  });

  it("gives an anonymous session's chat history and every memory 24 hours", async () => {
    const upstash = stubUpstash(keyspace);

    await expireAnonymousSession(
      session("session-a", { current: anonymous, initiator: anonymous }),
    );

    expect(upstash.expiries()).toEqual({
      "agentkit:chat:session-a:session-a": 86_400,
      "agentkit:memory:session-a:m1": 86_400,
      "agentkit:memory:session-a:m2": 86_400,
      "agentkit:memory:session-a:m3": 86_400,
    });
  });

  it("expires the chat history of a session that saved no memory", async () => {
    const upstash = stubUpstash(keyspace);

    await expireAnonymousSession(
      session("session-b2", { current: anonymous, initiator: anonymous }),
    );

    expect(upstash.expiries()).toEqual({
      "agentkit:chat:session-b2:session-b2": 86_400,
    });
  });

  it.each([
    ["a signed-in user", principal("user-7", "user")],
    ["the Vercel team's service principal", principal("team", "service")],
    ["the app's own runtime principal", principal("eve:app", "runtime")],
  ])("sends nothing for %s", async (_name, caller) => {
    const upstash = stubUpstash(keyspace);

    await expireAnonymousSession(
      session("session-a", { current: caller, initiator: caller }),
    );

    expect(upstash.commands).toEqual([]);
  });

  it("sends nothing for a signed-in turn on a session an anonymous caller started", async () => {
    const upstash = stubUpstash(keyspace);

    await expireAnonymousSession(
      session("session-a", {
        current: principal("user-7", "user"),
        initiator: anonymous,
      }),
    );

    expect(upstash.commands).toEqual([]);
  });

  it("sends nothing for a session with no caller", async () => {
    const upstash = stubUpstash(keyspace);

    await expireAnonymousSession(session("session-a", {}));

    expect(upstash.commands).toEqual([]);
  });

  it("expires only the session-keyed data of an anonymous turn on a signed-in caller's session", async () => {
    const upstash = stubUpstash(keyspace);

    await expireAnonymousSession(
      session("session-a", {
        current: anonymous,
        initiator: principal("user-7", "user"),
      }),
    );

    expect(Object.keys(upstash.expiries())).toEqual([
      "agentkit:chat:session-a:session-a",
      "agentkit:memory:session-a:m1",
      "agentkit:memory:session-a:m2",
      "agentkit:memory:session-a:m3",
    ]);
  });

  it("falls back to the initiator when the turn has no caller of its own", async () => {
    const upstash = stubUpstash(keyspace);

    await expireAnonymousSession(
      session("session-b", { initiator: anonymous }),
    );

    expect(Object.keys(upstash.expiries())).toEqual([
      "agentkit:chat:session-b:session-b",
      "agentkit:memory:session-b:m1",
    ]);
  });

  it("cannot reach another caller's keys through glob characters in a session id", async () => {
    const upstash = stubUpstash([...keyspace, "agentkit:memory:*:m9"]);

    await expireAnonymousSession(
      session("*", { current: anonymous, initiator: anonymous }),
    );

    expect(upstash.expiries()).toEqual({
      "agentkit:chat:*:*": 86_400,
      "agentkit:memory:*:m9": 86_400,
    });
  });

  it("replaces the key separator in a session id, as the extension does", async () => {
    const upstash = stubUpstash(["agentkit:memory:tenant_s1:m1"]);

    await expireAnonymousSession(
      session("tenant:s1", { current: anonymous, initiator: anonymous }),
    );

    expect(upstash.expiries()).toEqual({
      "agentkit:chat:tenant_s1:tenant_s1": 86_400,
      "agentkit:memory:tenant_s1:m1": 86_400,
    });
  });
});

describe("onAnonymousTurnEnded", () => {
  it("expires the session of the turn that ended", async () => {
    const upstash = stubUpstash(keyspace);

    await onAnonymousTurnEnded(
      { type: "turn.completed" },
      session("session-b", { current: anonymous, initiator: anonymous }),
    );

    expect(upstash.expiries()).toEqual({
      "agentkit:chat:session-b:session-b": 86_400,
      "agentkit:memory:session-b:m1": 86_400,
    });
  });

  it("logs a failed expiry instead of failing the turn", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "ERR unavailable" }, { status: 400 }),
    );
    const warn = vi
      .spyOn(winston, "warn")
      .mockImplementation(() => winston as never);

    await expect(
      onAnonymousTurnEnded(
        { type: "turn.failed" },
        session("session-a", { current: anonymous, initiator: anonymous }),
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "anonymous session expiry failed",
      expect.objectContaining({
        event: "anonymous_expiry_failed",
        sessionId: "session-a",
        reason: expect.stringContaining("ERR unavailable"),
      }),
    );
  });
});
