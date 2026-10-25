-- Runs once on fresh volume. POSTGRES_DB (sluice) already created by entrypoint.
-- Enable pgvector on the app database and provision a separate DB for Langfuse.
\connect sluice
CREATE EXTENSION IF NOT EXISTS vector;

CREATE DATABASE langfuse;
