import { defineDynamic, defineTool } from "eve/tools";
import { BASH_INPUT_SCHEMA, BASH_OUTPUT_SCHEMA, bash } from "eve/tools/bash";
import { identifiedCaller } from "#lib/caller";
import { parseEnv } from "#lib/env";

// eve's sandbox shell, decided per caller on a deployment that admits
// anonymous callers and left as eve's own default on every other one. Read
// the comment in agent/agent.ts before changing this file.
const forIdentifiedCallers = defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      identifiedCaller(ctx.session.auth)
        ? defineTool({
            description: bash.description,
            inputSchema: BASH_INPUT_SCHEMA,
            outputSchema: BASH_OUTPUT_SCHEMA,
            label: { start: (input) => bash.label?.start(input) ?? "bash" },
            execute: (input, ctx) => bash.execute(input, ctx),
          })
        : null,
  },
});

export default parseEnv().ALLOW_ANONYMOUS_ACCESS ? forIdentifiedCallers : bash;
