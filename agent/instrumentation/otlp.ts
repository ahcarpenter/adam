import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { otelIntegration } from "eve/instrumentation/otel";
import { parseEnv } from "#lib/env";

// Every span, AI or not, to the OTLP collector OTEL_EXPORTER_OTLP_ENDPOINT
// names for metrics. eve registers no @vercel/otel "auto" processor, which
// used to send spans there; on Vercel, eve's default Agent Runs destination
// takes the place of the platform collector "auto" preferred. The exporter
// reads the endpoint and headers from the environment itself, per the OTLP
// specification, like the metric exporter in agent/lib/metrics.ts.
export default otelIntegration(
  parseEnv().OTEL_EXPORTER_OTLP_ENDPOINT
    ? { traceExporter: new OTLPTraceExporter() }
    : {},
);
