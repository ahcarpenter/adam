import winston from "winston";
import type TransportStream from "winston-transport";

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

/**
 * Configures winston's default logger. Called once at startup from
 * agent/instrumentation.ts; tool files then log through the same instance
 * via a plain `import winston from "winston"` (package imports resolve to
 * the shared module under the eve runtime).
 */
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
