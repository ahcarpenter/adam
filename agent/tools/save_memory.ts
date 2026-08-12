import { defineMemorySaveTool } from "@upstash/agentkit-eve";

export default defineMemorySaveTool({
  userId: (_, ctx) => ctx.session.auth.current?.principalId ?? ctx.session.id,
});
