import agentkit from "@upstash/agentkit-eve-extension";
import { s } from "@upstash/redis";

// Single wiring point for Upstash AgentKit: long-term memory, RAG over a
// Redis Search index, and durable chat history. userId defaults to the
// verified principal, then the session id. Rate limiting stays in
// agent/channels/eve.ts (createRateLimitAuth from @upstash/agentkit-eve).
export default agentkit({
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
