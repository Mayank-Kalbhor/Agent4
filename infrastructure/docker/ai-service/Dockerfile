# Stage 1: Build dependency wheel
FROM python:3.11-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Production runner
FROM python:3.11-slim AS runner
WORKDIR /app

# Setup system user for non-root compliance
RUN groupadd -g 999 appuser && \
    useradd -r -u 999 -g appuser appuser

COPY --from=builder /root/.local /home/appuser/.local
COPY . .

# Adjust permissions
RUN chown -R appuser:appuser /app
USER appuser

ENV PATH=/home/appuser/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV PORT=5002

EXPOSE 5002
CMD ["python", "main.py"]
