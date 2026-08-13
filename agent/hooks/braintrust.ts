import { braintrustEveHook } from "braintrust";
import { defineState } from "eve/context";
import { defineHook, type HookDefinition } from "eve/hooks";
import { AGENT_NAME } from "#lib/agent-name";

// Braintrust vendors its own copy of eve's hook types, so the finished
// definition is bridged to eve's public type once, at this boundary.
export default defineHook(
  braintrustEveHook({
    defineState,
    metadata: {
      app: AGENT_NAME,
    },
  }) as HookDefinition,
);
