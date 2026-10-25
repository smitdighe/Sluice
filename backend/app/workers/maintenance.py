"""Maintenance queue: cron-driven periodic jobs (no request traffic triggers these).

purge_cache runs every 15 min — a balance between reclaiming expired rows promptly
and not hammering the DB with delete scans. Expired entries are already excluded
from lookups (ttl filter in semantic_cache), so purge is about reclaiming space,
not correctness; 15 min keeps the table from growing unbounded without adding
meaningful load.

quota_rollover: Phase 1's QuotaLedger has no active/period-state flag that
*requires* rollover, and quota accounting is not yet implemented (no writer
records usage). So this is a logged placeholder until quota logic lands — kept
here to establish the maintenance cron slot.
"""
from __future__ import annotations

import logging

from app.core.cache import invalidation

logger = logging.getLogger("sluice.maintenance")


async def purge_cache(ctx) -> int:
    purged = await invalidation.purge_expired()
    logger.info("cache purge removed %d expired entries", purged)
    return purged


async def quota_rollover(ctx) -> None:
    # Placeholder — quota accounting is not yet implemented. No schema state to
    # roll over yet; logging so the maintenance slot is observable.
    logger.info("quota_rollover: no-op (quota logic not yet implemented)")
