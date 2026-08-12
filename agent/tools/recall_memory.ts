import { defineMemoryRecallTool } from "@upstash/agentkit-eve";

export default defineMemoryRecallTool({
  userId: (_, ctx) => ctx.session.auth.current?.principalId ?? ctx.session.id,
  topK: 5,
  minScore: 1,
});
