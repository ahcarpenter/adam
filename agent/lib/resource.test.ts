import { beforeEach, describe, expect, it } from "vitest";
import TransportStream from "winston-transport";
import { configureDefaultLogger } from "./logger";
import { reportServiceNameDrift, telemetryResource } from "./resource";

class MemoryTransport extends TransportStream {
  public readonly records: Record<string, unknown>[] = [];

  override log(info: Record<string, unknown>, callback: () => void): void {
    this.records.push(info);
    callback();
  }
}

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

describe("reportServiceNameDrift", () => {
  let logged: MemoryTransport;

  beforeEach(() => {
    logged = new MemoryTransport();
    configureDefaultLogger({ extraTransports: [logged] });
  });

  it("says nothing when the names agree", () => {
    reportServiceNameDrift("adam", "adam");

    expect(logged.records).toHaveLength(0);
  });

  it("warns with both names when they diverge", () => {
    reportServiceNameDrift("adam", "adam-renamed");

    expect(logged.records.at(-1)).toMatchObject({
      level: "warn",
      event: "service_name_drift",
      configured: "adam",
      agentName: "adam-renamed",
    });
  });
});
