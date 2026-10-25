#!/bin/sh
# Single-container entrypoint (Render free tier): migrate, then serve the API
# with the arq worker pools running in-process (RUN_WORKERS_IN_PROCESS=true).
set -e
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips='*'
