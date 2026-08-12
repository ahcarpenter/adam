import { trace } from "@opentelemetry/api";
import type {
  InstrumentationRuntimeContext,
  InstrumentationSession,
  InstrumentationStepStartedEventResult,
} from "eve/instrumentation";

/**
 * Runtime context contributed by an earlier step.started handler (e.g. the
 * Braintrust integration), merged beneath this module's own contribution.
 */
export interface EarlierStepStartedResult {
  readonly runtimeContext?: InstrumentationRuntimeContext;
}

/**
 * Links model-call telemetry to the authenticated user. The session
 * initiator's principal wins over the current principal, so delegated turns
 * attribute to the human who started the session. Sets posthog.distinct_id
 * on the active span (PostHog LLM analytics) and merges the same id into the
 * step's runtime context on top of whatever an earlier handler contributed.
 * Returns undefined when there is nothing to contribute.
 */
export function attributeStep(
  auth: InstrumentationSession["auth"],
  fromEarlierHandler?: EarlierStepStartedResult,
): InstrumentationStepStartedEventResult | undefined {
  const distinctId = auth.initiator?.principalId ?? auth.current?.principalId;
  if (distinctId) {
    trace.getActiveSpan()?.setAttribute("posthog.distinct_id", distinctId);
  }

  const runtimeContext = {
    ...fromEarlierHandler?.runtimeContext,
    ...(distinctId ? { posthog_distinct_id: distinctId } : {}),
  };
  return Object.keys(runtimeContext).length > 0
    ? { runtimeContext }
    : undefined;
}
