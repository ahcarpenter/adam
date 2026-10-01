import { defineDynamic, defineTool } from "eve/tools";
import {
  WEB_FETCH_INPUT_SCHEMA,
  WEB_FETCH_OUTPUT_SCHEMA,
  webFetch,
} from "eve/tools/web_fetch";
import { identifiedCaller } from "#lib/caller";
import { parseEnv } from "#lib/env";

// eve's web fetch, decided per caller on a deployment that admits anonymous
// callers and left as eve's own default on every other one. Read the
// comment in agent/agent.ts before changing this file.
const forIdentifiedCallers = defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      identifiedCaller(ctx.session.auth)
        ? defineTool({
            description: webFetch.description,
            inputSchema: WEB_FETCH_INPUT_SCHEMA,
            outputSchema: WEB_FETCH_OUTPUT_SCHEMA,
            label: {
              start: (input) => webFetch.label?.start(input) ?? "web_fetch",
            },
            execute: (input, ctx) => webFetch.execute(input, ctx),
          })
        : null,
  },
});

export default parseEnv().ALLOW_ANONYMOUS_ACCESS
  ? forIdentifiedCallers
  : webFetch;
