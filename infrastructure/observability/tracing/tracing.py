import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

def setup_tracing(app=None):
    """
    Sets up OpenTelemetry Tracer Provider and registers OTLP gRPC exporters.
    Optionally auto-instruments FastAPI app if provided.
    """
    service_name = os.getenv("SERVICE_NAME", "python-service")
    environment = os.getenv("ENV", "production")

    # Define resource metadata
    resource = Resource.create(attributes={
        "service.name": service_name,
        "deployment.environment": environment
    })

    # Set globally scoped Tracer Provider
    provider = TracerProvider(resource=resource)
    trace.set_tracer_provider(provider)

    # Set gRPC trace exporter to OTEL Collector
    collector_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "otel-collector.monitoring.svc.cluster.local:4317")
    otlp_exporter = OTLPSpanExporter(endpoint=collector_endpoint, insecure=True)

    # Wrap spans in batches to optimize network traffic overhead
    span_processor = BatchSpanProcessor(otlp_exporter)
    provider.add_span_processor(span_processor)

    # Auto-instrument common HTTP request libraries
    RequestsInstrumentor().instrument()

    # If a FastAPI application is specified, apply auto-instrumentation
    if app:
        FastAPIInstrumentor.instrument_app(app)

    return trace.get_tracer(service_name)
