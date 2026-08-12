import { BraintrustExporter } from "@braintrust/otel";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { OpenTelemetryTransportV3 } from "@opentelemetry/winston-transport";
import { registerOTel } from "@vercel/otel";
import { defineInstrumentation } from "eve/instrumentation";
import winston from "winston";
import { type Env, parseEnv } from "./lib/env";
import { configureDefaultLogger } from "./lib/logger";

export default defineInstrumentation({
  setup: ({ agentName }) => {
    let env: Env;
    try {
      env = parseEnv();
    } catch (error) {
      // Production fails fast on a bad environment; local dev degrades to
      // console-only logging so the agent stays runnable without
      // PostHog/Braintrust/Upstash credentials.
      if (
        process.env.NODE_ENV === "production" ||
        process.env.VERCEL_ENV === "production"
      ) {
        throw error;
      }
      configureDefaultLogger();
      winston.warn("observability export disabled: incomplete environment", {
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // All logs — general and trace-correlated — flow to PostHog. Records
    // emitted inside an active span carry trace/span ids automatically.
    const loggerProvider = new LoggerProvider({
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${env.POSTHOG_HOST}/i/v1/logs`,
            headers: { Authorization: `Bearer ${env.POSTHOG_PROJECT_TOKEN}` },
          }),
        }),
      ],
    });
    logs.setGlobalLoggerProvider(loggerProvider);

    // winston default logger: JSON console + bridge into the OTel logs
    // pipeline above. Authored files log via `import winston from "winston"`.
    configureDefaultLogger({
      extraTransports: [new OpenTelemetryTransportV3()],
    });

    // Traces: only AI spans reach Braintrust (BRAINTRUST_API_KEY read by the
    // exporter). Non-AI spans are dropped by filterAISpans.
    registerOTel({
      serviceName: agentName,
      traceExporter: new BraintrustExporter({
        parent: `project_name:${agentName}`,
        filterAISpans: true,
      }),
    });
  },
});
