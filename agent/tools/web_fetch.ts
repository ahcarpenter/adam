import { defineDynamic } from "eve/tools";
import { webFetch } from "eve/tools/web_fetch";
import { identifiedCaller } from "#lib/caller";
import { parseEnv } from "#lib/env";

// eve's web fetch, decided per caller on a deployment that admits anonymous
// callers and left as eve's own default on every other one. Read the
// comment in agent/agent.ts before changing this file.
const forIdentifiedCallers = defineDynamic((ctx) =>
  identifiedCaller(ctx.session.auth) ? webFetch : null,
);

export default parseEnv().ALLOW_ANONYMOUS_ACCESS
  ? forIdentifiedCallers
  : webFetch;
