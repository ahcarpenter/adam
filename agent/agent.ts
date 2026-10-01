import { defineAgent } from "eve";
import { parseEnv } from "#lib/env";

export default defineAgent({
  // A string model ID routes through the Vercel AI Gateway, so no provider
  // key is involved. eve resolves a static gateway model at compile time and
  // does not import this module when the built agent starts, so the override
  // is read by `eve build` and `eve dev`, and parseEnv() here fails the build
  // on an incomplete environment. A started process is covered by the same
  // check in agent/instrumentation/.
  model: parseEnv().AI_GATEWAY_MODEL,
});
