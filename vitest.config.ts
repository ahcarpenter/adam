import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "agent/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "agent/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        // Wiring-only files: executed by the eve runtime at startup, not unit-testable.
        // Exclusions are mirrored in codecov.yml.
        "agent/agent.ts",
        "agent/instrumentation.ts",
        "agent/channels/**",
        "agent/extensions/**",
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
