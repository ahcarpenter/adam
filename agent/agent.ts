import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";
import { parseEnv } from "#lib/env";

export default defineAgent({
  // Full-environment validation at the earliest module: an incomplete
  // environment fails startup in every mode, local dev included.
  model: openai(parseEnv().OPENAI_MODEL),
});
