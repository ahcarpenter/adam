import { defineEvalConfig } from "eve/evals";
import { Braintrust } from "eve/evals/reporters";

// Every eval in this tree is deterministic (no t.judge.* assertions), so no
// judge model is configured. Experiments ship to their own Braintrust
// project, separate from the ones the running agent logs to, so an eval run
// never shows up in a project someone is reading during an incident.
// Requires BRAINTRUST_API_KEY; use `eve eval --skip-report` to iterate
// locally without uploading an experiment.
export default defineEvalConfig({
  reporters: [Braintrust({ projectName: "adam-evals" })],
});
