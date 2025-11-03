"""
Watchdog scheduler - monitors and recovers stuck jobs, performs maintenance
"""
import asyncio
import signal
import logging
from typing import Optional
from ..infra.db import db
from ..infra.settings import settings
from ..orchestrator.idempotency import IdempotencyCache

logger = logging.getLogger(__name__)


class Watchdog:
    """Monitors and recovers stuck jobs"""

    def __init__(self):
        self.running = False
        self.idem_cache: Optional[IdempotencyCache] = None

    async def initialize(self):
        """Initialize watchdog components"""
        await db.connect()
        self.idem_cache = IdempotencyCache(db)
        logger.info("Watchdog initialized")

    async def start(self):
        """Main watchdog loop"""
        if not self.idem_cache:
            await self.initialize()

        self.running = True
        logger.info("Watchdog started")

        # Setup signal handlers for graceful shutdown
        for sig in (signal.SIGTERM, signal.SIGINT):
            asyncio.get_event_loop().add_signal_handler(
                sig, lambda: asyncio.create_task(self.stop())
            )

        while self.running:
            try:
                # Sleep first to avoid immediate execution on start
                await asyncio.sleep(settings.WATCHDOG_INTERVAL)

                # Reset stale jobs
                reset_count = await self.reset_stale_jobs()
                if reset_count > 0:
                    logger.warning(f"Watchdog reset {reset_count} stale jobs")

                # Clean up expired idempotency cache
                if settings.ENABLE_IDEMPOTENCY_CACHE:
                    await self.cleanup_idempotency_cache()

                # Archive old completed jobs
                await self.archive_old_jobs()

            except Exception as e:
                logger.error(f"Watchdog error: {e}", exc_info=True)

        logger.info("Watchdog stopped")

    async def reset_stale_jobs(self) -> int:
        """
        Reset jobs with stale heartbeats

        Jobs are considered stale if:
        - Status is 'running'
        - heartbeat_at is older than threshold

        Returns:
            Number of jobs reset
        """
        stale_threshold = settings.WATCHDOG_STALE_THRESHOLD

        result = await db.execute(f"""
            UPDATE pf_jobs
            SET
              status = 'queued',
              leased_by = NULL,
              leased_at = NULL,
              heartbeat_at = NULL,
              not_before = NOW() + INTERVAL '30 seconds',
              version = version + 1,
              updated_at = NOW()
            WHERE status = 'running'
              AND heartbeat_at < NOW() - INTERVAL '{stale_threshold} seconds'
        """)

        # Extract count from result: "UPDATE N"
        count = int(result.split()[-1]) if result and result != "UPDATE 0" else 0

        if count > 0:
            logger.warning(
                f"Reset {count} stale jobs "
                f"(heartbeat older than {stale_threshold}s)"
            )

        return count

    async def cleanup_idempotency_cache(self):
        """Remove expired idempotency entries"""
        try:
            count = await self.idem_cache.clear_expired()
            if count > 0:
                logger.info(f"Cleaned up {count} expired idempotency cache entries")
        except Exception as e:
            logger.error(f"Error cleaning idempotency cache: {e}")

    async def archive_old_jobs(self, days: int = 30):
        """
        Move old completed jobs to archive table

        Args:
            days: Archive jobs older than this many days
        """
        try:
            # First, copy to archive
            await db.execute(f"""
                INSERT INTO pf_jobs_archive
                SELECT *, NOW() as archived_at
                FROM pf_jobs
                WHERE status IN ('done', 'failed')
                  AND updated_at < NOW() - INTERVAL '{days} days'
                ON CONFLICT DO NOTHING
            """)

            # Then delete from main table
            result = await db.execute(f"""
                DELETE FROM pf_jobs
                WHERE status IN ('done', 'failed')
                  AND updated_at < NOW() - INTERVAL '{days} days'
            """)

            # Extract count
            count = int(result.split()[-1]) if result and result != "DELETE 0" else 0

            if count > 0:
                logger.info(f"Archived {count} old jobs (older than {days} days)")

        except Exception as e:
            logger.error(f"Error archiving old jobs: {e}")

    async def update_run_statuses(self):
        """Update pipeline run statuses based on job completion"""
        try:
            # This is already handled by job_queue._update_run_progress
            # But we can do a sweep here to catch any edge cases
            result = await db.execute("""
                UPDATE pf_runs r
                SET
                  status = CASE
                    WHEN (SELECT COUNT(*) FROM pf_jobs WHERE run_id = r.id AND status IN ('running', 'queued')) = 0 THEN
                      CASE
                        WHEN (SELECT COUNT(*) FROM pf_jobs WHERE run_id = r.id AND status = 'failed') = 0 THEN 'done'
                        WHEN (SELECT COUNT(*) FROM pf_jobs WHERE run_id = r.id AND status = 'done') = 0 THEN 'failed'
                        ELSE 'partial'
                      END
                    ELSE r.status
                  END,
                  finished_at = CASE
                    WHEN (SELECT COUNT(*) FROM pf_jobs WHERE run_id = r.id AND status IN ('running', 'queued')) = 0
                      AND finished_at IS NULL
                    THEN NOW()
                    ELSE finished_at
                  END
                WHERE status = 'running'
                  AND (SELECT COUNT(*) FROM pf_jobs WHERE run_id = r.id AND status IN ('running', 'queued')) = 0
            """)

            count = int(result.split()[-1]) if result and result != "UPDATE 0" else 0

            if count > 0:
                logger.info(f"Updated status for {count} completed pipeline runs")

        except Exception as e:
            logger.error(f"Error updating run statuses: {e}")

    async def get_health_stats(self) -> dict:
        """
        Get watchdog health statistics

        Returns:
            Dictionary with health metrics
        """
        stats = {}

        try:
            # Count active workers
            stats["active_workers"] = await db.fetchval("""
                SELECT COUNT(DISTINCT leased_by)
                FROM pf_jobs
                WHERE status = 'running'
                  AND heartbeat_at > NOW() - INTERVAL '2 minutes'
            """) or 0

            # Count jobs by status
            rows = await db.fetch("""
                SELECT status, COUNT(*) as count
                FROM pf_jobs
                GROUP BY status
            """)

            stats["jobs"] = {row["status"]: row["count"] for row in rows}

            # Count running runs
            stats["active_runs"] = await db.fetchval("""
                SELECT COUNT(*) FROM pf_runs WHERE status = 'running'
            """) or 0

            # Count DLQ entries
            stats["dlq_count"] = await db.fetchval("""
                SELECT COUNT(*) FROM pf_jobs_dlq
            """) or 0

        except Exception as e:
            logger.error(f"Error fetching health stats: {e}")
            stats["error"] = str(e)

        return stats

    async def stop(self):
        """Graceful shutdown"""
        logger.info("Watchdog shutting down...")
        self.running = False


# Entry point
async def main():
    """Main entry point for watchdog process"""
    watchdog = Watchdog()

    try:
        await watchdog.start()
    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt")
        await watchdog.stop()
    finally:
        await db.disconnect()


if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    asyncio.run(main())
