import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
type DynamicTool = { events: { "session.started"(): Tool | null } };

let tools: {
  save_memory: Tool;
  recall_memory: Tool;
  read_chat_history: DynamicTool;
  search_chat_history: DynamicTool;
};

/** Commands sent to the stubbed Upstash REST endpoint since the last test. */
const commands: string[][] = [];

beforeAll(async () => {
  for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
  // Answers as an empty database: no document at any key, no search hits.
  vi.stubGlobal("fetch", async (_url: unknown, init: { body: string }) => {
    const answer = (command: string[]) => {
      commands.push(command);
      return { result: command[0] === "SEARCH.QUERY" ? [] : null };
    };
    const body = JSON.parse(init.body) as string[] | string[][];
    return Response.json(
      Array.isArray(body[0])
        ? (body as string[][]).map(answer)
        : answer(body as string[]),
    );
  });
  ambient[configScope] = "agentkit";
  await import("./agentkit");
  tools = (await import(
    "@upstash/agentkit-eve-extension/tools"
  )) as unknown as typeof tools;
});

beforeEach(() => {
  commands.length = 0;
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

function historyTool(tool: DynamicTool): Tool {
  const resolved = tool.events["session.started"]();
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
  await historyTool(tools.read_chat_history).execute(
    { sessionId: ctx.session.id },
    ctx,
  );
  await historyTool(tools.search_chat_history).execute({ query: "tea" }, ctx);
  return commands.slice(from);
}

/**
 * The user ids a set of commands reads or writes under, per store. A
 * document key carries its user as `agentkit:<store>:<userId>:<id>`, and a
 * search carries it as an exact-match `userId` filter on the store's index.
 */
function userIdsOf(sent: string[][]) {
  const ids = { memory: new Set<string>(), chat: new Set<string>() };
  for (const command of sent) {
    for (const arg of command.map(String)) {
      const key = /^agentkit:(memory|chat):([^:]+):/.exec(arg);
      if (key) ids[key[1] as keyof typeof ids].add(key[2] as string);
    }
    const index = /^agentkit_(memory|chat)$/.exec(String(command[1]));
    const filter = /"userId":\{"\$eq":"([^"]+)"\}/.exec(String(command[2]));
    if (index && filter) {
      ids[index[1] as keyof typeof ids].add(filter[1] as string);
    }
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
});
