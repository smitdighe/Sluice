"""Application settings loaded from environment / .env."""
from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Datastores
    database_url: str = "postgresql+asyncpg://sluice:sluice@localhost:5434/sluice"
    redis_url: str = "redis://localhost:6381/0"

    # Provider keys (optional until wired up)
    groq_api_key: str | None = None
    cerebras_api_key: str | None = None
    gemini_api_key: str | None = None

    # Langfuse
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str | None = None

    # App
    app_env: str = "development"
    log_level: str = "INFO"

    # CORS — comma-separated browser origins allowed to call the API.
    # Kept a plain str (not list[str]) because pydantic-settings would otherwise
    # demand JSON in the env var; prod overrides via CORS_ORIGINS.
    cors_origins: str = "http://localhost:5173"

    # Chaos fault injection — OFF unless explicitly enabled. When false, the
    # adapter wrapper is never even constructed (verifiably inert, zero overhead).
    chaos_enabled: bool = False

    # Run the three arq worker pools inside the API process instead of as
    # separate processes. For single-container hosts with no worker type.
    run_workers_in_process: bool = False

    @field_validator("database_url")
    @classmethod
    def _asyncpg_url(cls, v: str) -> str:
        """Accept the plain `postgres(ql)://...?sslmode=require` URLs that
        hosted Postgres providers hand out. asyncpg needs the +asyncpg driver
        and takes `ssl=` rather than libpq's `sslmode` / `channel_binding`."""
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                v = "postgresql+asyncpg://" + v[len(prefix):]
                break
        parts = urlsplit(v)
        query = dict(parse_qsl(parts.query))
        sslmode = query.pop("sslmode", None)
        query.pop("channel_binding", None)
        if sslmode and "ssl" not in query:
            query["ssl"] = sslmode
        return urlunsplit(parts._replace(query=urlencode(query)))

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
