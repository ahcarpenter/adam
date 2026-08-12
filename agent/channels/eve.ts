import { createRateLimitAuth, Ratelimit } from "@upstash/agentkit-eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

export default eveChannel({
  auth: [
    // Gate, not an identity provider: throttles POSTs (one turn consumes one
    // rate-limit slot) and falls through to the authenticators below when
    // under the limit.
    createRateLimitAuth({
      limiter: Ratelimit.slidingWindow(20, "1 m"),
      identifier: (req) => req.headers.get("x-forwarded-for") ?? "anonymous",
    }),
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // This placeholder will not allow browser requests in production.
    // Replace it with your app's auth provider, like Auth.js or Clerk,
    // or use none() for a public demo.
    placeholderAuth(),
  ],
});
