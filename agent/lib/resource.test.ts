import { describe, expect, it } from "vitest";
import { telemetryResource } from "./resource";

describe("telemetryResource", () => {
  it("names the service and its environment", () => {
    expect(telemetryResource("adam", "preview").attributes).toEqual({
      "service.name": "adam",
      "deployment.environment.name": "preview",
    });
  });

  it("resolves the environment when none is passed", () => {
    expect(telemetryResource("adam").attributes["service.name"]).toBe("adam");
  });
});
