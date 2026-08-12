import { braintrustEveHook } from "braintrust";
import { defineState } from "eve/context";
import { defineHook } from "eve/hooks";

export default defineHook(
  braintrustEveHook({
    defineState,
    metadata: {
      app: "adam",
    },
  }) as Parameters<typeof defineHook>[0],
);
