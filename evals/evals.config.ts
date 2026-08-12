import { defineEvalConfig } from "eve/evals";
import { Braintrust } from "eve/evals/reporters";

// Every eval in this tree is deterministic (no t.judge.* assertions), so no
// judge model is configured. Results ship to the "adam" Braintrust project —
// the same project the agent's instrumentation logs to — which requires
// BRAINTRUST_API_KEY in the environment. Use `eve eval --skip-report` to
// iterate locally without uploading an experiment.
export default defineEvalConfig({
  reporters: [Braintrust({ projectName: "adam" })],
});
