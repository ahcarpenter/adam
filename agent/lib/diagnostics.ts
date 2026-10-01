import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";

let installed = false;

/**
 * Surfaces OpenTelemetry's own failures. Exporters and batch processors
 * report a rejected export (bad token, wrong region host, 4xx from ingest)
 * through `diag` and otherwise swallow it, so without a diag logger the
 * telemetry pipeline fails completely silently.
 *
 * Deliberately the console logger and not winston: a log-export failure
 * reported through winston would be bridged back into the log exporter that
 * just failed, and each failure would generate the next one. Console output
 * is picked up by the platform's own runtime logs.
 */
export function ensureOtelDiagnostics(): void {
  if (installed) return;
  installed = true;
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
}

/**
 * Contains a telemetry failure so it cannot become the incident.
 *
 * Since eve 0.68 a thrown hook handler no longer fails the turn or the
 * session: eve logs it, runs the remaining subscribers and continues. In the
 * hooks this is now a precaution: a logging or metric call that fails must
 * not end a user's session. It is still load-bearing inside the auth walk,
 * where a throw would replace the limiter's 403 with a 500.
 *
 * Reported through `diag` (console) rather than winston — winston is one of
 * the things that can be failing here.
 */
export function neverThrow(what: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    diag.error(`${what} failed`, error);
  }
}
