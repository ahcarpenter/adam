/**
 * Runs `run` once per process, however many copies of the calling module the
 * process loads, and again on a later call if it threw.
 *
 * eve can load adam's modules more than once in one process: `eve build`
 * evaluates them to compile the agent, then loads them again as one shared
 * bundle to prepare the sandbox. Module state belongs to one copy, but
 * OpenTelemetry's global providers belong to the process, and the API
 * refuses a second registration with an error. So the record that a provider
 * was registered lives on the process too, under a registered symbol every
 * copy resolves to the same key.
 */
export function oncePerProcess(name: string, run: () => void): void {
  const key = Symbol.for(`adam.once-per-process.${name}`);
  const processState = globalThis as Record<symbol, true | undefined>;
  if (processState[key]) return;
  run();
  processState[key] = true;
}
