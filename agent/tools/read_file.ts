import { defineDynamic } from "eve/tools";
import { readFile } from "eve/tools/read_file";
import { identifiedCaller } from "#lib/caller";
import { parseEnv } from "#lib/env";

// eve's sandbox file reader, decided per caller on a deployment that admits
// anonymous callers and left as eve's own default on every other one. Read
// the comment in agent/agent.ts before changing this file.
const forIdentifiedCallers = defineDynamic((ctx) =>
  identifiedCaller(ctx.session.auth) ? readFile : null,
);

export default parseEnv().ALLOW_ANONYMOUS_ACCESS
  ? forIdentifiedCallers
  : readFile;
