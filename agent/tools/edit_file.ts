import { defineDynamic } from "eve/tools";
import { editFile } from "eve/tools/edit_file";
import { identifiedCaller } from "#lib/caller";
import { parseEnv } from "#lib/env";

// eve's sandbox file editor, decided per caller on a deployment that admits
// anonymous callers and left as eve's own default on every other one. It
// changes files as write_file does, so it follows the same rule. Read the
// comment in agent/agent.ts before changing this file.
const forIdentifiedCallers = defineDynamic((ctx) =>
  identifiedCaller(ctx.session.auth) ? editFile : null,
);

export default parseEnv().ALLOW_ANONYMOUS_ACCESS
  ? forIdentifiedCallers
  : editFile;
