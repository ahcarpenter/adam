import type {
  InstrumentationRuntimeContext,
  InstrumentationSession,
} from "eve/instrumentation";

/**
 * Links model-call telemetry to the authenticated user. The session
 * initiator's principal wins over the current principal, so delegated turns
 * attribute to the human who started the session. eve stamps the returned
 * runtime context onto the model call's spans as
 * `ai.settings.context.posthog_distinct_id`, which PostHog LLM analytics
 * reads as the event's distinct id. Returns undefined when there is nothing
 * to contribute.
 */
export function attributeStep(
  auth: InstrumentationSession["auth"],
): InstrumentationRuntimeContext | undefined {
  const distinctId = auth.initiator?.principalId ?? auth.current?.principalId;
  return distinctId ? { posthog_distinct_id: distinctId } : undefined;
}
