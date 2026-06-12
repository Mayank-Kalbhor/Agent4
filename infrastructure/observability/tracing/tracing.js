const opentelemetry = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

// Configure trace exporter pointing to EKS OTEL Collector agent
const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector.monitoring.svc.cluster.local:4317',
});

// Configure base Node SDK tracing provider
const sdk = new opentelemetry.NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME || 'node-service',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'production',
  }),
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy core instrumentations if needed
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

// Start SDK runtime
sdk.start();

// Handle graceful termination on system shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing SDK terminated successfully.'))
    .catch((err) => console.error('Error terminating Tracing SDK:', err))
    .finally(() => process.exit(0));
});

module.exports = sdk;
