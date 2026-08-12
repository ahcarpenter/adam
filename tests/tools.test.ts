import { describe, expect, it, vi } from "vitest";

// Tool modules read Upstash credentials from env (Redis.fromEnv) — stub
// before import so the definitions can be constructed without a live Redis.
vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");

const [recall, save, search, cached] = await Promise.all([
  import("../agent/tools/recall_memory"),
  import("../agent/tools/save_memory"),
  import("../agent/tools/search"),
  import("../agent/tools/cached_example"),
]);

describe("standalone tool definitions", () => {
  it("recall_memory default-exports a tool definition", () => {
    expect(recall.default).toBeTruthy();
    expect(recall.default.execute).toBeTypeOf("function");
  });

  it("save_memory default-exports a tool definition", () => {
    expect(save.default).toBeTruthy();
    expect(save.default.execute).toBeTypeOf("function");
  });

  it("search default-exports the search member of the tool set", () => {
    expect(search.default).toBeTruthy();
    expect(search.default.execute).toBeTypeOf("function");
  });

  it("cached_example default-exports a cached tool definition", () => {
    expect(cached.default).toBeTruthy();
    expect(cached.default.description).toContain("cached");
    expect(cached.default.execute).toBeTypeOf("function");
  });
});
