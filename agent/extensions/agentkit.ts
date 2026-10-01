import agentkit from "@upstash/agentkit-eve-extension";
import { s } from "@upstash/redis";
import { agentkitUserId } from "#lib/agentkit-user";

// Single wiring point for Upstash AgentKit. Rate limiting stays in
// agent/channels/eve.ts (createRateLimitAuth from @upstash/agentkit-eve).
export default agentkit({
  // Memory and chat history are keyed by this. The extension's default would
  // give every anonymous caller the same key; see agent/lib/agentkit-user.ts.
  userId: agentkitUserId,
  memory: { topK: 5, minScore: 1 },
  // Minimal placeholder index: replace the schema and indexName with your
  // domain documents. The index is created reactively on first use.
  search: {
    schema: s.object({
      title: s.string(),
      content: s.string(),
    }),
    indexName: "documents",
  },
  chatHistory: true,
});
