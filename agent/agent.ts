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
  // shell and files, web fetch, web search and the sub-agent. A deployment
  // that admits anonymous callers is therefore built without them, and four
  // come back for callers who have an identity: agent/tools/bash.ts,
  // read_file.ts, write_file.ts and web_fetch.ts then export a resolver eve
  // runs at the start of every turn, which offers the tool to an identified
  // caller and nothing to an anonymous one (agent/lib/caller.ts). On a
  // closed deployment those four files export eve's own tool unchanged.
  // Web search, the sub-agent tool and task_cancel cannot be decided per
  // caller: eve fixes them when the agent is built, so on an open deployment
  // they are off for everyone, signed-in callers included. load_skill is off
  // there too, since adam ships no skills for it to load.
  // The four files read the same setting as this one, and eve refuses every
  // request if they disagree with the build: an agent built with one value
  // and started with the other answers 500 rather than serving tools the
  // build did not intend.
  // What stays for an anonymous caller is not a default tool: chat, the
  // AgentKit memory and chat-history tools, and its document search (search,
  // search_aggregate, search_count), whose index is shared by every caller
  // and so readable by anyone. Read "Anonymous access" in
  // docs/configuration.md.
  defaultTools: !env.ALLOW_ANONYMOUS_ACCESS,
});
