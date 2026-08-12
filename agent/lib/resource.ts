import {
  type Resource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import winston from "winston";
import { type DeploymentEnvironment, resolveEnvironment } from "./environment";

/**
 * Shared resource for the log and metric providers this app builds itself.
 *
 * Without it both providers fall back to `defaultResource()`, which stamps
 * `service.name=unknown_service:node` — records arrive at the backend with
 * no way to tell which service or environment emitted them. Traces get their
 * resource from `registerOTel`; this keeps the other two signals aligned
 * with it.
 *
 * Attribute keys are the OpenTelemetry semantic conventions, written out
 * rather than pulled from `@opentelemetry/semantic-conventions` — a whole
 * dependency for two string constants.
 */
export function telemetryResource(
  serviceName: string,
  environment: DeploymentEnvironment = resolveEnvironment(),
): Resource {
  return resourceFromAttributes({
    "service.name": serviceName,
    "deployment.environment.name": environment,
  });
}

/**
 * Reports logs and metrics landing under a different service than traces.
 *
 * `OTEL_SERVICE_NAME` defaults to a literal because worker processes cannot
 * see the name eve resolved; only `instrumentation.ts` receives it. Renaming
 * the package therefore splits one service into two in the backend, with
 * nothing to notice it. Called from that one place where both values exist.
 *
 * A warning, not a startup failure: naming a worker separately is a
 * legitimate override, and this cannot tell the two cases apart.
 */
export function reportServiceNameDrift(
  configured: string,
  agentName: string,
): void {
  if (configured === agentName) return;

  winston.warn("telemetry service name does not match the agent name", {
    event: "service_name_drift",
    configured,
    agentName,
  });
}
