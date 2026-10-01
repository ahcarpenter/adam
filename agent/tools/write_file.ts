import { defineDynamic, defineTool } from "eve/tools";
import {
  WRITE_FILE_INPUT_SCHEMA,
  WRITE_FILE_OUTPUT_SCHEMA,
  writeFile,
} from "eve/tools/write_file";
import { identifiedCaller } from "#lib/caller";
import { parseEnv } from "#lib/env";

// eve's sandbox file writer, decided per caller on a deployment that admits
// anonymous callers and left as eve's own default on every other one. Read
// the comment in agent/agent.ts before changing this file.
const forIdentifiedCallers = defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      identifiedCaller(ctx.session.auth)
        ? defineTool({
            description: writeFile.description,
            inputSchema: WRITE_FILE_INPUT_SCHEMA,
            outputSchema: WRITE_FILE_OUTPUT_SCHEMA,
            label: {
              start: (input) => writeFile.label?.start(input) ?? "write_file",
            },
            execute: (input, ctx) => writeFile.execute(input, ctx),
          })
        : null,
  },
});

export default parseEnv().ALLOW_ANONYMOUS_ACCESS
  ? forIdentifiedCallers
  : writeFile;
