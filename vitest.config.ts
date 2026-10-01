import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["agent/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["agent/**/*.ts", "scripts/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        // Test support: issuers and environments that stand in for the real ones.
        "**/*.fixtures.ts",
        // Wiring-only files: executed by the eve runtime at startup, not unit-testable.
        // Exclusions are mirrored in codecov.yml.
        "agent/agent.ts",
        "agent/instrumentation/**",
        "agent/channels/**",
        "agent/extensions/**",
        "agent/hooks/**",
        // Compiled and run by eve: agent/caller-tools.test.ts drives them
        // through a real eve server, in a process coverage cannot see.
        "agent/tools/**",
        // The command's entry point: it opens a browser and starts eve's
        // client. Everything it calls is in scripts/sign-in.ts.
        "scripts/connect.ts",
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
