import { defineEvalConfig } from "eve/evals";
import { Braintrust } from "eve/evals/reporters";

// Every eval in this tree is deterministic (no t.judge.* assertions), so no
// judge model is configured. Experiments ship to their own Braintrust
// project, separate from the ones the running agent logs to, so an eval run
// never shows up in a project someone is reading during an incident.
// Requires BRAINTRUST_API_KEY; use `eve eval --skip-report` to iterate
// locally without uploading an experiment.
//
// The prefix repeats AGENT_NAME from agent/lib/agent-name.ts rather than
// importing it: whether eve's eval runner resolves an import across the tree
// boundary cannot be checked without a live eval run, and a broken config is
// a worse trade than a duplicated word. Rename one, rename the other.
export default defineEvalConfig({
  reporters: [Braintrust({ projectName: "adam-evals" })],
});
