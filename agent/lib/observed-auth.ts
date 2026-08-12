import { type AuthFn, ForbiddenError } from "eve/channels/auth";
import winston from "winston";
import { neverThrow } from "./diagnostics";
import { recordRateLimitRejection } from "./metrics";

/**
 * Makes rate-limit rejections observable.
 *
 * A throttled caller is turned away by the auth walk before a session or
 * turn exists, so it produces no AI span and nothing reaches Braintrust or
 * PostHog LLM analytics — throttling is otherwise invisible in every
 * backend. Only `ForbiddenError` counts: it is what the limiter throws when
 * a caller is over the window, and anything else (a Redis outage, say) must
 * not be reported as a rejection.
 *
 * The original error is always what propagates: a throwing metric or log
 * call would otherwise replace the limiter's 403 with a 500 and make the
 * gate look broken.
 */
export function observeRateLimit(auth: AuthFn<Request>): AuthFn<Request> {
  return async (request) => {
    try {
      return await auth(request);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        neverThrow("rate limit instrumentation", () => {
          recordRateLimitRejection();
          winston.warn("rate limit rejected request", {
            event: "rate_limit_rejected",
            method: request.method,
            path: new URL(request.url).pathname,
          });
        });
      }
      throw error;
    }
  };
}
