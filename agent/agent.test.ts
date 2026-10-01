import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { validEnv } from "#lib/env.fixtures";

const run = promisify(execFile);

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const eve = join(
  dirname(createRequire(import.meta.url).resolve("eve/package.json")),
  "bin/eve.js",
);

type Setting = "true" | "false" | undefined;

/**
 * The tool set eve resolves for this agent under one state of the setting.
 * `eve info` compiles the agent the way `eve build` does and prints what the
 * model will be offered, so this is eve's own answer, not a reading of
 * agent/agent.ts.
 */
async function resolvedTools(setting: Setting): Promise<string[]> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...validEnv };
  delete env.ALLOW_ANONYMOUS_ACCESS;
  if (setting !== undefined) env.ALLOW_ANONYMOUS_ACCESS = setting;
  const { stdout } = await run(process.execPath, [eve, "info", "--json"], {
    cwd: appRoot,
    env,
  });
  return (JSON.parse(stdout) as { tools: string[] }).tools;
}

// Every tool eve adds to an agent that does not ask for it: the sandbox
// shell and files, web fetch, web search, the sub-agent, and the two that
// only serve those.
const defaultTools = [
  "bash",
  "read_file",
  "write_file",
  "web_fetch",
  "web_search",
  "agent",
  "task_cancel",
  "load_skill",
];

describe("agent tool set", () => {
  const tools = new Map<Setting, string[]>();

  beforeAll(async () => {
    for (const setting of [undefined, "false", "true"] as const) {
      tools.set(setting, await resolvedTools(setting));
    }
  }, 120_000);

  describe.each<Setting>([undefined, "false"])(
    "with ALLOW_ANONYMOUS_ACCESS=%s",
    (setting) => {
      it.each(defaultTools)("keeps eve's default %s tool", (tool) => {
        expect(tools.get(setting)).toContain(tool);
      });
    },
  );

  describe("with ALLOW_ANONYMOUS_ACCESS=true", () => {
    it.each(defaultTools)("offers no %s tool", (tool) => {
      expect(tools.get("true")).not.toContain(tool);
    });

    it("keeps every tool that is not an eve default, memory included", () => {
      const open = tools.get("true");

      expect(open).toEqual(
        tools.get(undefined)?.filter((tool) => !defaultTools.includes(tool)),
      );
      expect(open).toEqual(
        expect.arrayContaining([
          "agentkit__recall_memory",
          "agentkit__save_memory",
        ]),
      );
    });
  });
});
