import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description: "The agent boots, accepts a message, and produces a reply.",
  async test(t) {
    const turn = await t.send("Hello! Introduce yourself in one sentence.");
    t.succeeded();
    t.check(
      turn.message,
      satisfies<string | undefined>(
        (reply) => (reply ?? "").trim().length > 0,
        "non-empty reply",
      ),
    );
  },
});
