import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";

const model = process.env.OPENAI_MODEL;
if (!model) throw new Error("OPENAI_MODEL is required (see env.example)");

export default defineAgent({
  model: openai(model),
});
