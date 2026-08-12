import agentkit from "@upstash/agentkit-eve-extension";

// Extension scoped to durable chat-history capture only. Long-term memory and
// RAG are owned by the standalone files in agent/tools/ (see spec); the
// extension's default memory tools are disabled in ./tools/.
export default agentkit({ chatHistory: true });
