import { defineDynamic, defineTool } from "eve/tools";
import {
  READ_FILE_INPUT_SCHEMA,
  READ_FILE_OUTPUT_SCHEMA,
  readFile,
} from "eve/tools/read_file";
import { identifiedCaller } from "#lib/caller";
import { parseEnv } from "#lib/env";

// eve's sandbox file reader, decided per caller on a deployment that admits
// anonymous callers and left as eve's own default on every other one. Read
// the comment in agent/agent.ts before changing this file.
const forIdentifiedCallers = defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      identifiedCaller(ctx.session.auth)
        ? defineTool({
            description: readFile.description,
            inputSchema: READ_FILE_INPUT_SCHEMA,
            outputSchema: READ_FILE_OUTPUT_SCHEMA,
            label: {
              start: (input) => readFile.label?.start(input) ?? "read_file",
            },
            execute: (input, ctx) => readFile.execute(input, ctx),
          })
        : null,
  },
});

export default parseEnv().ALLOW_ANONYMOUS_ACCESS
  ? forIdentifiedCallers
  : readFile;
