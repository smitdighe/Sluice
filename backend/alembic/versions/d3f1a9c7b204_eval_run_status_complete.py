"""rename eval_runs.status 'completed' -> 'complete'

The API contract's terminal-success enum value is 'complete'. The column was
written with 'completed' (and defaulted to it), so both the stored rows and the
server_default are corrected here — the app no longer writes 'completed'
anywhere (see app.models.db_models.EvalRunStatus).

Revision ID: d3f1a9c7b204
Revises: b71c4a0d9e52
Create Date: 2026-07-29
"""
from collections.abc import Sequence
from typing import Union

from alembic import op

revision: str = 'd3f1a9c7b204'
down_revision: Union[str, Sequence[str], None] = 'b71c4a0d9e52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE eval_runs SET status = 'complete' WHERE status = 'completed'")
    op.execute("ALTER TABLE eval_runs ALTER COLUMN status SET DEFAULT 'complete'")


def downgrade() -> None:
    op.execute("ALTER TABLE eval_runs ALTER COLUMN status SET DEFAULT 'completed'")
    op.execute("UPDATE eval_runs SET status = 'completed' WHERE status = 'complete'")
