import { defineSearchTools } from "@upstash/agentkit-eve";
import { s } from "@upstash/redis";

// Minimal placeholder index: replace the schema and indexName with your
// domain documents. The index is created reactively on first use; seed it by
// writing documents with your schema under the same indexName. Eve snapshots
// tool files, so aggregate/count variants must repeat this exact config in
// their own files (export .aggregate / .count).
export default defineSearchTools({
  schema: s.object({
    title: s.string(),
    content: s.string(),
  }),
  indexName: "documents",
}).search;
