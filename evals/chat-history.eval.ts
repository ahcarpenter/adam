import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "AgentKit chat history: a fact stated earlier in the session is recalled in a later turn.",
  async test(t) {
    await t.send("For this conversation, my project code name is bluebird-42.");
    await t.send(
      "What is my project code name? Reply with just the code name.",
    );
    t.succeeded();
    t.messageIncludes(/bluebird-42/i);
  },
});
