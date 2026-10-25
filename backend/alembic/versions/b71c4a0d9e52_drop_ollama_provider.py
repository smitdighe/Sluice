"""drop ollama from provider_name enum

Ollama is no longer a supported provider. Postgres has no ALTER TYPE ... DROP
VALUE, so the enum is recreated without 'ollama' and the two columns using it
are re-typed.

Rows still carrying 'ollama' are deleted first — they are provider transition
audit entries for a provider that no longer exists. quota_ledger is included for
completeness (it uses the same enum).

Revision ID: b71c4a0d9e52
Revises: c2bcba60bda7
Create Date: 2026-07-29
"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b71c4a0d9e52'
down_revision: Union[str, Sequence[str], None] = 'c2bcba60bda7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = [("provider_health_log", "provider"), ("quota_ledger", "provider")]
_WITHOUT = ("groq", "cerebras", "gemini")
_WITH = ("groq", "cerebras", "gemini", "ollama")


def _recreate(values: tuple[str, ...]) -> None:
    joined = ", ".join(f"'{v}'" for v in values)
    op.execute("ALTER TYPE provider_name RENAME TO provider_name_old")
    op.execute(f"CREATE TYPE provider_name AS ENUM ({joined})")
    for table, column in _COLUMNS:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN {column} "
            f"TYPE provider_name USING {column}::text::provider_name"
        )
    op.execute("DROP TYPE provider_name_old")


def upgrade() -> None:
    for table, column in _COLUMNS:
        op.execute(sa.text(f"DELETE FROM {table} WHERE {column} = 'ollama'"))
    _recreate(_WITHOUT)


def downgrade() -> None:
    # Re-adds the value; the deleted rows are not recoverable.
    _recreate(_WITH)
