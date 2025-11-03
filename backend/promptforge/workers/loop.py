"""
Worker loop - processes jobs from the queue
"""
import asyncio
from typing import Optional
import logging
import signal
from ..models.domain import Job
from ..orchestrator.job_queue import JobQueue
from ..orchestrator.idempotency import IdempotencyCache
from ..orchestrator.dag_executor import DAGExecutor
from ..orchestrator.retry_policy import RetryPolicy
from ..stages.registry import get_stage_registry
from ..infra.db import db
from ..infra.settings import settings, get_worker_id

logger = logging.getLogger(__name__)


class Worker:
    """Async worker that processes jobs from the queue"""

    def __init__(
        self,
        worker_id: Optional[str] = None,
        max_concurrent_jobs: int = None
    ):
        self.worker_id = worker_id or get_worker_id()
        self.max_concurrent_jobs = max_concurrent_jobs or settings.WORKER_MAX_CONCURRENT_JOBS

        self.queue: Optional[JobQueue] = None
        self.idem: Optional[IdempotencyCache] = None
        self.dag_executor: Optional[DAGExecutor] = None
        self.stage_registry = get_stage_registry()

        self.semaphore = asyncio.Semaphore(self.max_concurrent_jobs)
        self.running = False
        self.active_tasks = set()

    async def initialize(self):
        """Initialize worker components"""
        # Ensure database is connected
        await db.connect()

        # Initialize components
        self.queue = JobQueue(db, self.worker_id)
        self.idem = IdempotencyCache(db)
        self.dag_executor = DAGExecutor(db)

        logger.info(
            f"Worker {self.worker_id} initialized "
            f"(max_concurrent={self.max_concurrent_jobs})"
        )

    async def start(self):
        """Main worker loop"""
        if not self.queue:
            await self.initialize()

        self.running = True
        logger.info(f"Worker {self.worker_id} started")

        # Setup signal handlers for graceful shutdown
        for sig in (signal.SIGTERM, signal.SIGINT):
            asyncio.get_event_loop().add_signal_handler(
                sig, lambda: asyncio.create_task(self.stop())
            )

        while self.running:
            try:
                # Acquire semaphore to control concurrency
                async with self.semaphore:
                    # Lease next job
                    job = await self.queue.lease_next_job()

                    if job:
                        # Process job in background task
                        task = asyncio.create_task(self.process_job(job))
                        self.active_tasks.add(task)
                        task.add_done_callback(self.active_tasks.discard)
                    else:
                        # No jobs available, backoff
                        await asyncio.sleep(5)

            except Exception as e:
                logger.error(f"Worker loop error: {e}", exc_info=True)
                await asyncio.sleep(10)

        # Wait for active tasks to complete
        if self.active_tasks:
            logger.info(f"Waiting for {len(self.active_tasks)} active tasks to complete...")
            await asyncio.gather(*self.active_tasks, return_exceptions=True)

        logger.info(f"Worker {self.worker_id} stopped")

    async def process_job(self, job: Job):
        """
        Process a single job with heartbeat and error handling

        Args:
            job: Job to process
        """
        logger.info(
            f"Processing job {job.id}: {job.stage_key} "
            f"for doc {job.doc_id} (attempt {job.attempts + 1}/{job.max_attempts})"
        )

        # Start heartbeat task
        heartbeat_task = asyncio.create_task(self.heartbeat_loop(job))

        try:
            # Check idempotency cache
            if settings.ENABLE_IDEMPOTENCY_CACHE:
                cached_output = await self.idem.check(job.run_id, job.stage_key, job.input_json)
                if cached_output:
                    logger.info(f"Job {job.id} hit idempotency cache")
                    await self.queue.complete_job(job.id, job.version, cached_output)
                    return

            # Get stage implementation
            stage = self.stage_registry.get_stage(job.stage_key)

            # Execute with timeout
            timeout = stage.get_timeout_seconds()
            result = await asyncio.wait_for(
                stage.execute(job.input_json),
                timeout=timeout
            )

            if result.success:
                # Success path
                if settings.ENABLE_IDEMPOTENCY_CACHE:
                    await self.idem.store(
                        job.run_id, job.stage_key,
                        job.input_json, result.output
                    )

                await self.queue.complete_job(
                    job.id,
                    job.version,
                    result.output,
                    llm_tokens_used=result.tokens_used,
                    llm_cost_usd=result.cost_usd
                )

                # Queue next stages
                pipeline_config = await self.dag_executor.get_pipeline_config(job.run_id)
                await self.dag_executor.queue_next_stages(
                    completed_job=job,
                    output=result.output,
                    pipeline_config=pipeline_config
                )

                logger.info(f"Job {job.id} completed successfully")
            else:
                # Failure path
                error_category = RetryPolicy.categorize_error(result.error)
                await self.queue.fail_job(
                    job.id, job.version,
                    result.error, error_category.value
                )
                logger.error(f"Job {job.id} failed: {result.error}")

        except asyncio.TimeoutError:
            error_category = "transient"
            await self.queue.fail_job(
                job.id, job.version,
                TimeoutError(f"Stage timeout after {timeout}s"),
                error_category
            )
            logger.error(f"Job {job.id} timed out after {timeout}s")

        except Exception as e:
            error_category = RetryPolicy.categorize_error(e).value
            await self.queue.fail_job(job.id, job.version, e, error_category)
            logger.error(f"Job {job.id} failed with exception: {e}", exc_info=True)

        finally:
            # Stop heartbeat
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

    async def heartbeat_loop(self, job: Job):
        """
        Periodically update job heartbeat

        Args:
            job: Job to heartbeat
        """
        version = job.version
        interval = settings.WORKER_HEARTBEAT_INTERVAL

        while True:
            try:
                await asyncio.sleep(interval)

                success = await self.queue.heartbeat(job.id, version)

                if not success:
                    # Version mismatch: job was stolen or reset
                    logger.warning(
                        f"Job {job.id} heartbeat failed (version mismatch). "
                        "Job may have been reassigned."
                    )
                    break

                version += 1  # Increment local version

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Heartbeat error for job {job.id}: {e}")

    async def stop(self):
        """Graceful shutdown"""
        logger.info(f"Worker {self.worker_id} shutting down...")
        self.running = False


# Entry point
async def main():
    """Main entry point for worker process"""
    worker = Worker()

    try:
        await worker.start()
    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt")
        await worker.stop()
    finally:
        await db.disconnect()


if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    asyncio.run(main())
