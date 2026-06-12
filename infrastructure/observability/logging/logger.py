import logging
import os
import sys
import structlog
from structlog.contextvars import merge_contextvars

def setup_logging():
    # Configure structlog processors pipeline
    processors = [
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        merge_contextvars, # Merges thread/async contextvars (tenant_id, trace_id)
        add_service_context,
        structlog.processors.JSONRenderer() # JSON rendering output
    ]

    structlog.configure(
        processors=processors,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Root logger standard setup to forward logs to stdout
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
    )

def add_service_context(logger, method_name, event_dict):
    """Adds static service identifiers to log payloads"""
    event_dict["service"] = os.getenv("SERVICE_NAME", "python-service")
    # Set default values for trace context if not populated
    if "tenant_id" not in event_dict:
        event_dict["tenant_id"] = None
    if "trace_id" not in event_dict:
        event_dict["trace_id"] = None
    return event_dict

# Usage example:
# from structlog.contextvars import bind_contextvars
# bind_contextvars(tenant_id="tenant-123", trace_id="trace-abc")
# logger = structlog.get_logger()
# logger.info("LLM inference complete", tokens_used=150)
