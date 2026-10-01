import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { run, VERCEL_SIGN_IN } from "#scripts/sign-in";

// `pnpm connect <url>`: the entry point for scripts/sign-in.ts, and the two
// things it does to the machine it runs on.

/**
 * Opens a URL with the platform's own opener. A failure is not fatal: the
 * URL is printed as well.
 */
function openInBrowser(url: string): void {
  const [command, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["rundll32", "url.dll,FileProtocolHandler", url]
        : ["xdg-open", url];
  spawn(command as string, args, { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

/**
 * Starts eve's terminal client on the agent with the ID token as its bearer
 * header. eve's client takes a header only as an argument, so for as long
 * as it runs the token is visible in this machine's process list.
 */
function connectWithEve(url: string, idToken: string): Promise<number> {
  const eve = join(
    dirname(createRequire(import.meta.url).resolve("eve/package.json")),
    "bin/eve.js",
  );
  const client = spawn(
    process.execPath,
    [
      eve,
      "remote",
      "connect",
      "--url",
      url,
      "-H",
      `Authorization: Bearer ${idToken}`,
    ],
    { stdio: "inherit" },
  );
  return new Promise((resolve, reject) => {
    client.once("error", reject);
    client.once("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * The client ID, from the environment or from .env.local. Only that one
 * value is read from the file: the rest of it is the agent's secrets, which
 * this command has no use for and must not pass on to the client it starts.
 */
function appClientId(): string | undefined {
  if (process.env.VERCEL_APP_CLIENT_ID) return process.env.VERCEL_APP_CLIENT_ID;
  if (!existsSync(".env.local")) return undefined;
  return parseEnv(readFileSync(".env.local", "utf8")).VERCEL_APP_CLIENT_ID;
}

process.exitCode = await run(process.argv.slice(2), {
  ...VERCEL_SIGN_IN,
  env: { VERCEL_APP_CLIENT_ID: appClientId() },
  open: openInBrowser,
  connect: connectWithEve,
  log: (line) => console.error(line),
});
