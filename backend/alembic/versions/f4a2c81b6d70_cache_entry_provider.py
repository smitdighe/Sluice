"""add cache_entries.provider (originating generator for cache hits)

A cache hit must report the provider that ORIGINALLY generated the cached text
as `provider_used` (contract), so the generator is now stored alongside the
response. Nullable: rows written before this column existed have no recoverable
originating provider, and backfilling them with a guess would be wrong.

Revision ID: f4a2c81b6d70
Revises: d3f1a9c7b204
Create Date: 2026-07-29
"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f4a2c81b6d70'
down_revision: Union[str, Sequence[str], None] = 'd3f1a9c7b204'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'cache_entries',
        sa.Column('provider', sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('cache_entries', 'provider')
