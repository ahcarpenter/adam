import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { OpenTelemetryTransportV3 } from "@opentelemetry/winston-transport";
import winston from "winston";
import type TransportStream from "winston-transport";
import { parseEnv } from "./env";

export interface ConfigureLoggerOptions {
  level?: string;
  /** Extra transports appended to the JSON console transport (e.g. the OTel bridge). */
  extraTransports?: TransportStream[];
}

const structuredFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

/** Configures winston's default logger with JSON console output plus any extras. */
export function configureDefaultLogger(
  options: ConfigureLoggerOptions = {},
): void {
  winston.configure({
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    format: structuredFormat,
    transports: [
      new winston.transports.Console(),
      ...(options.extraTransports ?? []),
    ],
  });
}

/**
 * Self-configuring bootstrap: makes the current process's winston default
 * logger ready to use. The eve runtime executes hooks, tools, and
 * instrumentation in separate workers, so no single startup call can
 * configure them all — instead, every logging module calls ensureLogger()
 * once (at import time) and gets: JSON console output, plus the OTel bridge
 * exporting to PostHog when the environment is complete. No-op when the
 * default logger already has transports.
 */
export function ensureLogger(): void {
  // winston's typings do not expose the module-level default logger.
  const defaultLogger = (
    winston as unknown as { default: { transports: unknown[] } }
  ).default;
  if (defaultLogger.transports.length > 0) return;

  try {
    const env = parseEnv();
    const provider = new LoggerProvider({
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${env.POSTHOG_HOST}/i/v1/logs`,
            headers: { Authorization: `Bearer ${env.POSTHOG_PROJECT_TOKEN}` },
          }),
        }),
      ],
    });
    logs.setGlobalLoggerProvider(provider);
    configureDefaultLogger({
      extraTransports: [new OpenTelemetryTransportV3()],
    });
  } catch (error) {
    // Incomplete env: console-only logging so local dev keeps working.
    // Production still fails fast in agent/instrumentation.ts.
    configureDefaultLogger();
    winston.warn("log export disabled: incomplete environment", {
      detail: (error as Error).message,
    });
  }
}
