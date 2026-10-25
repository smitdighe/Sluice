# App image for the Sluice API and arq workers.
FROM python:3.13-slim

# uv for dependency management.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install deps first for layer caching.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    FASTEMBED_CACHE_PATH=/app/.models

# Bake the embedding model into the image so a cold start never downloads it.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('sentence-transformers/all-MiniLM-L6-v2', cache_dir='/app/.models')"

# App source.
COPY . .

# Strip CRLF in case the repo was checked out on Windows.
RUN sed -i 's/\r$//' start-web.sh && chmod +x start-web.sh

# Default to the cache worker; compose overrides `command` per worker service,
# and single-container hosts (Render) run ./start-web.sh.
CMD ["arq", "app.workers.worker.CacheWorkerSettings"]
