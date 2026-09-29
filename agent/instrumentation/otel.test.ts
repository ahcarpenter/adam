import type { TraceCaptureContext } from "eve/instrumentation/otel";
import { describe, expect, it } from "vitest";
import declaration from "./otel";

const environments = ["development", "preview", "production"] as const;
const audiences = ["public", "private", "unknown"] as const;

// Content capture is a data-flow decision (docs/observability.md,
// SECURITY.md), so it is pinned here rather than left to eve's
// audience-aware default, which a dropped or edited policy would restore
// without any other signal.
describe("otel trace policy", () => {
  it.each(
    environments.flatMap((environment) =>
      audiences.map((audience) => ({ environment, audience })),
    ),
  )(
    "records inputs and outputs in $environment for $audience conversations",
    ({ environment, audience }) => {
      const trace: TraceCaptureContext = {
        agentName: "adam",
        audience,
        channel: { kind: "channel:eve" },
        environment,
        principalType: "user",
      };

      expect(declaration.options.tracePolicy?.(trace)).toEqual({
        emit: true,
        recordInputs: true,
        recordOutputs: true,
      });
    },
  );
});
