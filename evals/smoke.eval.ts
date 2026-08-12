import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description: "The agent boots, accepts a message, and produces a reply.",
  async test(t) {
    await t.send("Hello! Introduce yourself in one sentence.");
    t.succeeded();
    t.check(
      t.reply,
      satisfies<string | null>(
        (reply) => (reply ?? "").trim().length > 0,
        "non-empty reply",
      ),
    );
  },
});
