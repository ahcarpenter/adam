import { describe, expect, it, vi } from "vitest";

vi.mock("#lib/logger", () => ({ ensureLogger: () => {} }));
vi.mock("#lib/metrics", () => ({ ensureMetrics: () => {} }));

const { default: channel } = await import("./eve");

// eve caps trace content to metadata for private and unknown conversations
// outside development, whatever agent/instrumentation/otel.ts's tracePolicy
// says. The full capture that policy pins (docs/observability.md,
// SECURITY.md) therefore depends on this channel classifying every
// conversation public. eve does not expose the classifier on the public
// Channel type, so this reads the one its runtime calls at session creation.
type AudienceClassifier = (input: {
  caller: unknown;
  auth: unknown;
  channel: { kind: string };
  environment: string;
  state: undefined;
}) => string;
const classify = (
  channel as unknown as {
    adapter: { instrumentation: { audience: AudienceClassifier } };
  }
).adapter.instrumentation.audience;

const callers = [
  { name: "anonymous", caller: { type: "anonymous" }, auth: null },
  {
    name: "authenticated user",
    caller: {
      type: "principal",
      principal: { kind: "user", authenticator: "vercel-oidc", attributes: {} },
    },
    auth: {
      principalType: "user",
      authenticator: "vercel-oidc",
      attributes: {},
    },
  },
] as const;

describe("eve channel trace audience", () => {
  it.each(
    ["development", "preview", "production"].flatMap((environment) =>
      callers.map((c) => ({ ...c, environment })),
    ),
  )(
    "classifies $name conversations in $environment as public",
    ({ caller, auth, environment }) => {
      expect(
        classify({
          caller,
          auth,
          channel: { kind: "channel:eve" },
          environment,
          state: undefined,
        }),
      ).toBe("public");
    },
  );
});
