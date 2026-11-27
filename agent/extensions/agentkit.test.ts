import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { expireAnonymousSession } from "#lib/anonymous-expiry";
import { validEnv } from "#lib/env.fixtures";

// These tests run the extension's own tools over this repository's mount and
// read the commands they send to Upstash, because the keys in those commands
// are what decides whether two callers share memory and chat history.

// eve binds a mount's config under the extension's namespace, which its
// bundler supplies. Outside a build the package falls back to this ambient
// scope, so setting it before the package loads lets the mount bind as it
// does at runtime.
const configScope = Symbol.for("eve.ext-config-scope");
const ambient = globalThis as Record<symbol, unknown>;

type Tool = { execute(input: unknown, ctx: unknown): Promise<unknown> };

// The chat-history tools are defineDynamic() definitions, which eve resolves
// before each model call. eve keeps the resolver under this registered
// symbol, so that separately bundled copies of eve can read each other's
// definitions; calling it is what eve does.
const resolver: unique symbol = Symbol.for("eve.dynamic");
type DynamicTool = { [resolver](ctx: unknown): Tool | null };

let tools: {
  save_memory: Tool;
  recall_memory: Tool;
  read_chat_history: DynamicTool;
  search_chat_history: DynamicTool;
};

/** Commands sent to the stubbed Upstash REST endpoint since the last test. */
const commands: string[][] = [];

/** The keys the stubbed database holds, for the one command that lists keys. */
let stored: string[] = [];

beforeAll(async () => {
  for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
  // Answers as an empty database: no document at any key, no search hits.
  // Like Upstash, it answers in base64 only when the request asks for it
  // with `Upstash-Encoding: base64`; the client decides whether to ask.
  vi.stubGlobal(
    "fetch",
    async (_url: unknown, init: { body: string; headers?: HeadersInit }) => {
      const encode =
        new Headers(init.headers).get("Upstash-Encoding") === "base64"
          ? (value: string) => Buffer.from(value).toString("base64")
          : (value: string) => value;
      const answer = (command: string[]) => {
        commands.push(command);
        if (String(command[0]).toUpperCase() === "SCAN") {
          const prefix = String(command[3]).replace(/\*$/, "");
          const found = stored.filter((key) => key.startsWith(prefix));
          return { result: [encode("0"), found.map(encode)] };
        }
        return { result: command[0] === "SEARCH.QUERY" ? [] : null };
      };
      const body = JSON.parse(init.body) as string[] | string[][];
      return Response.json(
        Array.isArray(body[0])
          ? (body as string[][]).map(answer)
          : answer(body as string[]),
      );
    },
  );
  ambient[configScope] = "agentkit";
  await import("./agentkit");
  tools = (await import(
    "@upstash/agentkit-eve-extension/tools"
  )) as unknown as typeof tools;
});

beforeEach(() => {
  commands.length = 0;
  stored = [];
});

afterAll(() => {
  delete ambient[configScope];
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// What eve's none() returns for every caller it accepts.
const anonymous = {
  attributes: {},
  authenticator: "none",
  principalId: "anonymous",
  principalType: "anonymous",
};

function session(id: string, caller: typeof anonymous) {
  return { session: { id, auth: { current: caller, initiator: caller } } };
}

function historyTool(tool: DynamicTool, ctx: unknown): Tool {
  const resolved = tool[resolver](ctx);
  if (!resolved) throw new Error("the mount did not enable chat history");
  return resolved;
}

/**
 * One caller using everything the extension keys by user: saving and
 * recalling a memory, then reading and searching chat history. Returns the
 * Upstash commands that took.
 */
async function visit(ctx: ReturnType<typeof session>) {
  const from = commands.length;
  await tools.save_memory.execute({ text: "prefers oolong" }, ctx);
  await tools.recall_memory.execute({ query: "tea" }, ctx);
  await historyTool(tools.read_chat_history, ctx).execute(
    { sessionId: ctx.session.id },
    ctx,
  );
  await historyTool(tools.search_chat_history, ctx).execute(
    { query: "tea" },
    ctx,
  );
  return commands.slice(from);
}

/** A document key, which carries its user as `agentkit:<store>:<userId>:<id>`. */
const documentKey = /^agentkit:(memory|chat):([^:]+):/;

/**
 * The searches a set of commands ran, with the store each searched and the
 * user its exact-match `userId` filter names. Memory and chat history share
 * one index, `agentkit`; a chat document is the one with a session id, so a
 * memory search excludes documents that have one.
 */
function searchesOf(sent: string[][]) {
  return sent
    .filter(([name, index]) => name === "SEARCH.QUERY" && index === "agentkit")
    .map(([, , query]) => ({
      store: /"\$mustNot":\[\{"sessionId"/.test(String(query))
        ? "memory"
        : "chat",
      userId: /"userId":\{"\$eq":"([^"]+)"\}/.exec(String(query))?.[1],
    }));
}

/**
 * The user ids a set of commands reads or writes under, per store: from the
 * document keys it names and the user filters of its searches.
 */
function userIdsOf(sent: string[][]) {
  const ids = { memory: new Set<string>(), chat: new Set<string>() };
  for (const command of sent) {
    for (const arg of command.map(String)) {
      const key = documentKey.exec(arg);
      if (key) ids[key[1] as keyof typeof ids].add(key[2] as string);
    }
  }
  for (const { store, userId } of searchesOf(sent)) {
    ids[store as keyof typeof ids].add(String(userId));
  }
  return ids;
}

describe("agentkit extension user keys", () => {
  it("keeps two anonymous sessions' memory and chat history apart", async () => {
    const first = await visit(session("session-a", anonymous));
    const second = await visit(session("session-b", anonymous));

    expect(userIdsOf(first)).toEqual({
      memory: new Set(["session-a"]),
      chat: new Set(["session-a"]),
    });
    expect(userIdsOf(second)).toEqual({
      memory: new Set(["session-b"]),
      chat: new Set(["session-b"]),
    });
    // Both searches ran, each filtered to its own session.
    expect(searchesOf(first)).toEqual([
      { store: "memory", userId: "session-a" },
      { store: "chat", userId: "session-a" },
    ]);
    expect(searchesOf(second)).toEqual([
      { store: "memory", userId: "session-b" },
      { store: "chat", userId: "session-b" },
    ]);
    // The id every anonymous caller shares never reaches the store.
    expect(JSON.stringify([first, second])).not.toContain("anonymous");
  });

  it("writes an anonymous session's memory and reads its history under its own key", async () => {
    const sent = await visit(session("session-a", anonymous));

    expect(sent.map((command) => command.slice(0, 2))).toEqual(
      expect.arrayContaining([
        ["JSON.SET", expect.stringMatching(/^agentkit:memory:session-a:/)],
        ["JSON.GET", "agentkit:chat:session-a:session-a"],
      ]),
    );
  });

  it("keeps a signed-in caller on one key across sessions", async () => {
    const user = {
      attributes: {},
      authenticator: "oidc",
      principalId: "https://issuer.example:user-7",
      principalType: "user",
    };

    const first = await visit(session("session-a", user));
    const second = await visit(session("session-b", user));

    // The extension replaces `:`, Redis's key separator, in a user id.
    const key = "https_//issuer.example_user-7";
    for (const sent of [first, second]) {
      expect(userIdsOf(sent)).toEqual({
        memory: new Set([key]),
        chat: new Set([key]),
      });
    }
  });

  // agent/lib/anonymous-expiry.ts expires an anonymous session's data by
  // key, and the key layout is this extension's, not adam's. If a new
  // version writes anywhere else, the expiry would silently stop reaching
  // it, so this runs the extension and the expiry against each other. The
  // chat key is taken from the read: the extension builds a chat's key in
  // one place for reads and writes, and its write runs in a hook the
  // package does not export.
  it("keeps an anonymous session's data where adam's 24-hour expiry reaches it", async () => {
    const ctx = session("visitor-1", anonymous);
    const sent = await visit(ctx);
    stored = [
      ...new Set(
        sent
          .flat()
          .map(String)
          .filter((arg) => documentKey.test(arg)),
      ),
    ];
    expect(stored).toEqual([
      expect.stringMatching(/^agentkit:memory:/),
      expect.stringMatching(/^agentkit:chat:/),
    ]);

    const from = commands.length;
    await expireAnonymousSession(ctx as never);

    const expired = commands
      .slice(from)
      .filter(([name]) => String(name).toUpperCase() === "EXPIRE");
    expect(expired.map(([, key]) => key).sort()).toEqual([...stored].sort());
    for (const [, , seconds] of expired) expect(seconds).toBe(86_400);
  });
});
