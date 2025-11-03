"""
Job queue management - leasing, heartbeat, state transitions
"""
import json
from typing import Optional, Dict, Any
from uuid import UUID
from datetime import datetime, timedelta
import logging
from ..models.domain import Job, JobStatus, ErrorCategory
from .retry_policy import RetryPolicy

logger = logging.getLogger(__name__)


class JobQueue:
    """Manages job leasing and state transitions"""

    def __init__(self, db, worker_id: str):
        self.db = db
        self.worker_id = worker_id

    async def lease_next_job(self) -> Optional[Job]:
        """
        Lease next available job using SKIP LOCKED for concurrency safety

        Returns:
            Job object if available, None if queue is empty
        """
        row = await self.db.fetchrow("""
            WITH cte AS (
              SELECT id
              FROM pf_jobs
              WHERE status = 'queued'
                AND not_before <= NOW()
              ORDER BY not_before ASC, id ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            UPDATE pf_jobs j
            SET
              status = 'running',
              leased_by = $1,
              leased_at = NOW(),
              heartbeat_at = NOW(),
              version = version + 1,
              updated_at = NOW()
            FROM cte
            WHERE j.id = cte.id
            RETURNING
              j.id, j.run_id, j.project_id, j.doc_id, j.stage_key,
              j.input_json, j.attempts, j.max_attempts, j.version,
              j.status, j.not_before, j.leased_by, j.leased_at,
              j.heartbeat_at, j.created_at, j.updated_at
        """, self.worker_id)

        if not row:
            return None

        # Convert asyncpg Record to Job object
        job = Job(
            id=row["id"],
            run_id=row["run_id"],
            project_id=row["project_id"],
            doc_id=row["doc_id"],
            stage_key=row["stage_key"],
            status=JobStatus(row["status"]),
            attempts=row["attempts"],
            max_attempts=row["max_attempts"],
            not_before=row["not_before"],
            leased_by=row["leased_by"],
            leased_at=row["leased_at"],
            heartbeat_at=row["heartbeat_at"],
            version=row["version"],
            input_json=json.loads(row["input_json"]) if row["input_json"] else {},
            created_at=row["created_at"],
            updated_at=row["updated_at"]
        )

        logger.info(f"Worker {self.worker_id} leased job {job.id} (stage={job.stage_key}, doc={job.doc_id})")
        return job

    async def heartbeat(self, job_id: int, version: int) -> bool:
        """
        Update heartbeat with optimistic locking

        Args:
            job_id: Job ID
            version: Current version for optimistic locking

        Returns:
            True if heartbeat succeeded, False if version mismatch
        """
        result = await self.db.execute("""
            UPDATE pf_jobs
            SET heartbeat_at = NOW(), version = version + 1, updated_at = NOW()
            WHERE id = $1 AND version = $2 AND status = 'running'
        """, job_id, version)

        success = result == "UPDATE 1"

        if not success:
            logger.warning(f"Heartbeat failed for job {job_id} (version mismatch or not running)")

        return success

    async def complete_job(
        self,
        job_id: int,
        version: int,
        output: Dict[str, Any],
        llm_tokens_used: Optional[int] = None,
        llm_cost_usd: Optional[float] = None
    ):
        """
        Mark job as done and queue next stages

        Args:
            job_id: Job ID
            version: Current version for optimistic locking
            output: Output data from stage execution
            llm_tokens_used: Number of LLM tokens consumed
            llm_cost_usd: Cost in USD
        """
        async with self.db.transaction() as conn:
            # Update job status
            await conn.execute("""
                UPDATE pf_jobs
                SET
                  status = 'done',
                  output_json = $1,
                  llm_tokens_used = $2,
                  llm_cost_usd = $3,
                  version = version + 1,
                  updated_at = NOW()
                WHERE id = $4 AND version = $5
            """, json.dumps(output), llm_tokens_used, llm_cost_usd, job_id, version)

            # Get job details for queuing next stages
            job = await conn.fetchrow("""
                SELECT run_id, project_id, doc_id, stage_key
                FROM pf_jobs WHERE id = $1
            """, job_id)

            # Update run progress
            await self._update_run_progress(conn, job["run_id"])

        logger.info(f"Job {job_id} completed successfully (stage={job['stage_key']})")

    async def fail_job(
        self,
        job_id: int,
        version: int,
        error: Exception,
        error_category: str
    ):
        """
        Mark job as failed and handle retry/DLQ logic

        Args:
            job_id: Job ID
            version: Current version for optimistic locking
            error: Exception that caused the failure
            error_category: Error category (transient, permanent, etc.)
        """
        # Get job details
        job = await self.db.fetchrow("""
            SELECT attempts, max_attempts, run_id, project_id, doc_id, stage_key, input_json
            FROM pf_jobs WHERE id = $1
        """, job_id)

        attempts = job["attempts"] + 1
        error_cat = ErrorCategory(error_category)

        # Determine if we should retry
        should_retry = RetryPolicy.should_retry(error_cat, attempts, job["max_attempts"])

        if should_retry:
            # Retry with exponential backoff
            backoff_seconds, _ = RetryPolicy.compute_backoff(attempts, error_cat)

            await self.db.execute("""
                UPDATE pf_jobs
                SET
                  status = 'queued',
                  attempts = $1,
                  not_before = NOW() + INTERVAL '1 second' * $2,
                  error_code = $3,
                  error_msg = $4,
                  error_category = $5,
                  leased_by = NULL,
                  leased_at = NULL,
                  heartbeat_at = NULL,
                  version = version + 1,
                  updated_at = NOW()
                WHERE id = $6 AND version = $7
            """, attempts, backoff_seconds, type(error).__name__, str(error)[:500],
                error_category, job_id, version)

            logger.warning(
                f"Job {job_id} failed (attempt {attempts}/{job['max_attempts']}), "
                f"retrying in {backoff_seconds}s: {error}"
            )
        else:
            # Move to DLQ
            await self._move_to_dlq(job_id, error, error_category)

            # Update run progress
            async with self.db.transaction() as conn:
                await self._update_run_progress(conn, job["run_id"])

            logger.error(
                f"Job {job_id} permanently failed ({error_category}), "
                f"moved to DLQ: {error}"
            )

    async def _move_to_dlq(self, job_id: int, error: Exception, error_category: str):
        """Move job to dead letter queue"""
        async with self.db.transaction() as conn:
            # Copy to DLQ
            await conn.execute("""
                INSERT INTO pf_jobs_dlq
                SELECT *, NOW(), $1
                FROM pf_jobs
                WHERE id = $2
            """, job_id, job_id)  # original_job_id = job_id

            # Mark as failed
            await conn.execute("""
                UPDATE pf_jobs
                SET
                  status = 'failed',
                  error_code = $1,
                  error_msg = $2,
                  error_category = $3,
                  updated_at = NOW()
                WHERE id = $4
            """, type(error).__name__, str(error)[:500], error_category, job_id)

    async def _update_run_progress(self, conn, run_id: UUID):
        """Update pipeline run progress counters"""
        await conn.execute("""
            UPDATE pf_runs r
            SET
              completed_jobs = (SELECT COUNT(*) FROM pf_jobs WHERE run_id = r.id AND status = 'done'),
              failed_jobs = (SELECT COUNT(*) FROM pf_jobs WHERE run_id = r.id AND status = 'failed'),
              updated_at = NOW()
            WHERE id = $1
        """, run_id)

        # Check if run is complete
        run = await conn.fetchrow("""
            SELECT total_jobs, completed_jobs, failed_jobs
            FROM pf_runs WHERE id = $1
        """, run_id)

        total_finished = run["completed_jobs"] + run["failed_jobs"]

        if total_finished >= run["total_jobs"] and run["total_jobs"] > 0:
            if run["failed_jobs"] == 0:
                new_status = "done"
            elif run["completed_jobs"] == 0:
                new_status = "failed"
            else:
                new_status = "partial"

            await conn.execute("""
                UPDATE pf_runs
                SET status = $1, finished_at = NOW()
                WHERE id = $2
            """, new_status, run_id)

            logger.info(f"Pipeline run {run_id} finished with status: {new_status}")

    async def create_job(
        self,
        run_id: UUID,
        project_id: Optional[UUID],
        doc_id: Optional[UUID],
        stage_key: str,
        input_json: Dict[str, Any],
        max_attempts: int = 3
    ) -> int:
        """
        Create a new job in the queue

        Args:
            run_id: Pipeline run ID
            project_id: Project ID
            doc_id: Document ID
            stage_key: Stage identifier
            input_json: Input data for the stage
            max_attempts: Maximum retry attempts

        Returns:
            Job ID
        """
        job_id = await self.db.fetchval("""
            INSERT INTO pf_jobs (run_id, project_id, doc_id, stage_key, status, input_json, max_attempts)
            VALUES ($1, $2, $3, $4, 'queued', $5, $6)
            ON CONFLICT (run_id, doc_id, stage_key) DO NOTHING
            RETURNING id
        """, run_id, project_id, doc_id, stage_key, json.dumps(input_json), max_attempts)

        if job_id:
            logger.info(f"Created job {job_id} (run={run_id}, stage={stage_key}, doc={doc_id})")

        return job_id
