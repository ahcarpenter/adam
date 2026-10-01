import { defineAgent } from "eve";
import { parseEnv } from "#lib/env";

// eve resolves this module at compile time and does not import it when the
// built agent starts, so both settings below are read by `eve build` and
// `eve dev`, and parseEnv() here fails the build on an incomplete
// environment. A started process is covered by the same check in
// agent/instrumentation/.
const env = parseEnv();

export default defineAgent({
  // A string model ID routes through the Vercel AI Gateway, so no provider
  // key is involved.
  model: env.AI_GATEWAY_MODEL,
  // An anonymous caller must not reach eve's default tools: the sandbox
  // shell and files, web fetch, web search and the sub-agent. This is one
  // deployment-wide switch on purpose: a deployment that admits anonymous
  // callers runs without them for everyone. eve could decide the shell,
  // file and web-fetch tools per caller through dynamic tool resolvers, but
  // web search and the sub-agent tool are fixed at build. What stays is not
  // a default tool: chat, the AgentKit memory and chat-history tools, and
  // its document search (search, search_aggregate, search_count), whose
  // index is shared by every caller and so readable by anyone. Read
  // "Anonymous access" in docs/configuration.md.
  defaultTools: !env.ALLOW_ANONYMOUS_ACCESS,
});
