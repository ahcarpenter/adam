/**
 * The eve agent name, which is this package's `name`.
 *
 * eve resolves it at compile time and hands it to instrumentation `setup` as
 * `agentName`, but only there: worker processes, OpenTelemetry destinations
 * built at module load, and the eval config have no runtime access to it,
 * and all of them need it to name a telemetry destination. One literal, so
 * those cannot drift apart from each other; `reportServiceNameDrift` catches
 * drift from the real agent name if the package is ever renamed.
 */
export const AGENT_NAME = "adam";
