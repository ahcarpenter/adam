import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client, ClientError } from "eve/client";
import type { Delivery } from "eve/sessions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validEnv } from "#lib/env.fixtures";
import { startIssuer } from "#lib/vercel-sign-in.fixtures";

// Which tools a caller is offered is decided inside eve, before every model
// call, from files eve compiles. So this runs eve itself, built and
// started as a deployment is: a real server, real HTTP requests, real route
// auth, and adam's own agent/agent.ts, agent/tools/ and sign-in
// authenticator. Only two things are stood in for. The model is eve's
// mockModel, which answers with the names of the tools eve offered it, so
// no model is called. And Vercel, as the issuer of sign-in tokens, is a
// local server.
//
// The agent under test is a scratch eve app that imports adam's files from
// where they are, because the model is part of agent/agent.ts and cannot be
// swapped from outside. No test here runs a sandbox tool: a sandbox needs
// Docker or a package adam does not install, and what is under test is
// which tools a caller is offered, not what the tools do.

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const eve = join(
  dirname(createRequire(import.meta.url).resolve("eve/package.json")),
  "bin/eve.js",
);
const clientId = "cl_adam_test";

// The five of eve's default tools that can be decided per caller.
const perCaller = ["bash", "edit_file", "read_file", "web_fetch", "write_file"];

/** An import specifier for one of adam's own files, as source text. */
const adam = (path: string) => JSON.stringify(join(appRoot, path));

let vercel: Awaited<ReturnType<typeof startIssuer>>;

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function writeScratchApp(root: string) {
  await mkdir(join(root, "agent/channels"), { recursive: true });
  await mkdir(join(root, "agent/tools"));
  await symlink(join(appRoot, "node_modules"), join(root, "node_modules"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "adam-caller-tools-test",
      private: true,
      type: "module",
      dependencies: { eve: "*" },
    }),
  );
  // adam's own tool files, re-exported from where they are.
  for (const tool of perCaller) {
    await writeFile(
      join(root, `agent/tools/${tool}.ts`),
      `export { default } from ${adam(`agent/tools/${tool}.ts`)};\n`,
    );
  }
  await writeFile(join(root, "agent/instructions.md"), "A test agent.\n");
  // adam's agent definition with only the model replaced.
  await writeFile(
    join(root, "agent/agent.ts"),
    `import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
import adam from ${adam("agent/agent.ts")};

export default defineAgent({
  ...adam,
  model: mockModel(({ tools }) =>
    JSON.stringify(tools.map((tool) => tool.name).sort()),
  ),
  modelContextWindowTokens: 100_000,
});
`,
  );
  // The two entries of adam's auth list that decide who a caller is on an
  // open deployment. The rate limiter is left out: it needs Upstash.
  await writeFile(
    join(root, "agent/channels/eve.ts"),
    `import { none } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { vercelSignIn } from ${adam("agent/lib/vercel-sign-in.ts")};

export default eveChannel({
  auth: [
    vercelSignIn({
      clientId: ${JSON.stringify(clientId)},
      issuer: process.env.TEST_ISSUER,
    }),
    none(),
  ],
});
`,
  );
}

/** The environment a scratch app runs in, under one state of the setting. */
function environment(allowAnonymousAccess: "true" | "false") {
  return {
    ...process.env,
    ...validEnv,
    // Under vitest's NODE_ENV=test eve swaps every authored model for its
    // own bootstrap model, which does not report the tools.
    NODE_ENV: "production",
    ALLOW_ANONYMOUS_ACCESS: allowAnonymousAccess,
    TEST_ISSUER: vercel.issuer,
  };
}

const scratchApps: string[] = [];

interface Running {
  host: string;
  /** Everything the server has printed. */
  log: () => string;
  stop: () => Promise<void>;
}

/**
 * Builds a scratch app under one state of the setting and starts the built
 * output under another, the way a deployment is built and then run:
 * `eve build`, then `eve start`. Resolves once the server is listening. eve
 * prints that line itself; the health route is not asked, because some of
 * the servers below are meant to be broken.
 */
async function deploy(input: {
  built: "true" | "false";
  started: "true" | "false";
}): Promise<Running> {
  const root = await mkdtemp(join(tmpdir(), "adam-caller-tools-"));
  scratchApps.push(root);
  await writeScratchApp(root);
  // Compile only: a sandbox is prepared on a real build, and none is used.
  await promisify(execFile)(
    process.execPath,
    [eve, "build", "--skip-sandbox-prewarm"],
    { cwd: root, env: environment(input.built) },
  );

  const port = await freePort();
  const server: ChildProcess = spawn(
    process.execPath,
    [eve, "start", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      env: environment(input.started),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  for (const stream of [server.stdout, server.stderr]) {
    stream?.on("data", (chunk) => {
      log += String(chunk);
    });
  }
  const deadline = Date.now() + 90_000;
  while (!log.includes("server listening at")) {
    if (server.exitCode !== null || Date.now() > deadline) {
      server.kill();
      throw new Error(`eve did not start:\n${log}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    host: `http://127.0.0.1:${port}`,
    log: () => log,
    stop: async () => {
      if (server.exitCode !== null) return;
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await exited;
    },
  };
}

beforeAll(async () => {
  vercel = await startIssuer();
});

afterAll(async () => {
  await vercel.close();
  for (const root of scratchApps) {
    await rm(root, { recursive: true, force: true });
  }
});

function caller(host: string, sub?: string) {
  return new Client({
    baseUrl: host,
    ...(sub
      ? { auth: { bearer: vercel.idToken({ aud: clientId, sub }) } }
      : {}),
  });
}

/** The tools eve offered the model on one turn, as the mock model reports. */
async function offered(server: Running, delivery: Delivery): Promise<string[]> {
  const result = await delivery.result();
  if (result.status === "failed" || result.reply === undefined) {
    throw new Error(
      `the message ended ${result.status} (${result.outcome}):\n${JSON.stringify(result.error, null, 2)}\n${server.log()}`,
    );
  }
  try {
    return JSON.parse(result.reply) as string[];
  } catch {
    throw new Error(
      `the model was not adam's mock: ${result.reply}\n${server.log()}`,
    );
  }
}

// eve's default tools that stay off for every caller on an open deployment:
// two that eve fixes when the agent is built, and the sub-agent's task tools,
// which eve adds only with the sub-agent.
const offForEveryone = [
  "agent",
  "eve__task_cancel",
  "eve__task_wait",
  "web_search",
];

describe("tools per caller, on a deployment open to anonymous callers", () => {
  let open: Running;

  beforeAll(async () => {
    open = await deploy({ built: "true", started: "true" });
  }, 300_000);

  afterAll(() => open?.stop());

  const tools = async (sub?: string) => {
    const { delivery } = await caller(open.host, sub).sessions.create({
      message: "hello",
    });
    return offered(open, delivery);
  };

  // The AgentKit extension is not mounted in the scratch app, so the list
  // of an anonymous caller is empty rather than memory and search.
  it("offers an anonymous caller none of eve's default tools", async () => {
    expect(await tools()).toEqual([]);
  }, 60_000);

  it("offers a signed-in caller the shell, file and web-fetch tools", async () => {
    expect(await tools("user_1")).toEqual(perCaller);
  }, 60_000);

  it.each(offForEveryone)(
    "offers no caller the %s tool",
    async (tool) => {
      expect(await tools("user_1")).not.toContain(tool);
    },
    60_000,
  );

  // eve does not enforce session ownership, so a caller is judged turn by
  // turn: knowing a signed-in user's session id earns an anonymous caller
  // nothing, and signing in mid-session is enough to get the tools.
  it("decides again on every turn, as the caller of a session changes", async () => {
    const { session, delivery } = await caller(
      open.host,
      "user_1",
    ).sessions.create({ message: "hello" });
    expect(await offered(open, delivery)).toEqual(perCaller);

    const anonymous = caller(open.host).sessions.attach(delivery.sessionId);
    expect(await offered(open, await anonymous.send("hello again"))).toEqual(
      [],
    );

    expect(await offered(open, await session.send("and again"))).toEqual(
      perCaller,
    );
  }, 90_000);

  it("offers the tools to a caller who signs in on an anonymous session", async () => {
    const { delivery } = await caller(open.host).sessions.create({
      message: "hello",
    });
    expect(await offered(open, delivery)).toEqual([]);

    const signedIn = caller(open.host, "user_1").sessions.attach(
      delivery.sessionId,
    );
    expect(await offered(open, await signedIn.send("hello again"))).toEqual(
      perCaller,
    );
  }, 90_000);

  it("resolves every tool without an error", () => {
    // eve logs a resolver that throws, or that answers differently when it
    // runs again, under these messages.
    expect(open.log()).not.toMatch(
      /Dynamic value ".*" (failed|didn't evaluate|returned something different)/,
    );
  });
});

// agent/agent.ts and the four tool files read ALLOW_ANONYMOUS_ACCESS when
// the agent is built, and the tool files read it again when it starts. The
// dangerous disagreement is an agent built closed, with eve's default tools
// compiled in, started open: anonymous callers are admitted. This pins what
// eve does then, which is refuse every request, so an upgrade that started
// serving such an agent would fail here rather than in production.
describe.each([
  { built: "false", started: "true", detail: "to provide an execute function" },
  { built: "true", started: "false", detail: "to be created by defineDynamic" },
] as const)(
  "an agent built with ALLOW_ANONYMOUS_ACCESS=$built and started with $started",
  ({ built, started, detail }) => {
    let mismatched: Running;

    beforeAll(async () => {
      mismatched = await deploy({ built, started });
    }, 300_000);

    afterAll(() => mismatched?.stop());

    it.each([
      ["an anonymous caller", undefined],
      ["a signed-in caller", "user_1"],
    ])(
      "answers %s 500 and runs no turn",
      async (_, sub) => {
        const failure = await caller(mismatched.host, sub)
          .sessions.create({ message: "hello" })
          .then(
            () => undefined,
            (error: unknown) => error,
          );

        expect(failure).toBeInstanceOf(ClientError);
        expect((failure as ClientError).status).toBe(500);
        expect(mismatched.log()).toContain(detail);
        expect(mismatched.log()).toMatch(/from "tools\/\w+\.ts"/);
      },
      60_000,
    );
  },
);
