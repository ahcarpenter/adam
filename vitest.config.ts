import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["agent/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["agent/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        // Wiring-only files: executed by the eve runtime at startup, not unit-testable.
        // Exclusions are mirrored in codecov.yml.
        "agent/agent.ts",
        "agent/instrumentation.ts",
        "agent/channels/**",
        "agent/extensions/**",
        "agent/hooks/**",
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
