import {
  type Resource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
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
