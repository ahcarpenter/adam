import { defineCachedTool } from "@upstash/agentkit-eve";
import winston from "winston";
import { z } from "zod";

// Pattern reference for Redis-memoized tools: replace `execute` with a real
// expensive operation (API call, heavy query). A repeated identical input
// within ttlSeconds is served from cache — verify via the unchanged
// `computedAt` or the `agentkit:toolCache:*` keys in Redis.
export default defineCachedTool({
  description:
    "Example cached tool. Echoes its input with the computation timestamp; repeated calls within the TTL return the cached result.",
  inputSchema: z.object({ input: z.string() }),
  toolName: "cached_example",
  userId: (_, ctx) => ctx.session.auth.current?.principalId ?? ctx.session.id,
  ttlSeconds: 3600,
  execute: async ({ input }) => {
    winston.info("cached_example computed", { toolName: "cached_example" });
    return { input, computedAt: new Date().toISOString() };
  },
});
