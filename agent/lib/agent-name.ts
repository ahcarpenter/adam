/**
 * The eve agent name, which is this package's `name`.
 *
 * eve resolves it at compile time and hands it to `instrumentation.ts` as
 * `context.agentName`, but only there — the other worker processes and the
 * eval config have no runtime access to it, and both need it to name a
 * telemetry destination. One literal, so those two cannot drift apart from
 * each other; `reportServiceNameDrift` catches drift from the real agent
 * name if the package is ever renamed.
 */
export const AGENT_NAME = "adam";
