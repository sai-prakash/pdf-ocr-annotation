"""
DAG Executor - handles stage transitions and queuing next stages
"""
import json
from typing import Dict, Any, List, Optional
from uuid import UUID
import logging
from ..models.domain import Job, PipelineDefinition

logger = logging.getLogger(__name__)


class DAGExecutor:
    """Executes DAG logic: queues next stages after job completion"""

    def __init__(self, db):
        self.db = db

    async def queue_next_stages(
        self,
        completed_job: Job,
        output: Dict[str, Any],
        pipeline_config: PipelineDefinition
    ):
        """
        Queue next stages in the pipeline after a job completes

        Args:
            completed_job: The job that just completed
            output: Output from the completed job
            pipeline_config: Pipeline configuration
        """
        current_stage_key = completed_job.stage_key

        # Get current stage config
        if current_stage_key not in pipeline_config.stages:
            logger.error(f"Stage {current_stage_key} not found in pipeline config")
            return

        stage_config = pipeline_config.stages[current_stage_key]
        next_stage_keys = stage_config.next_stages

        if not next_stage_keys:
            # Terminal stage reached
            logger.info(
                f"Terminal stage reached: {current_stage_key} "
                f"(run={completed_job.run_id}, doc={completed_job.doc_id})"
            )
            return

        logger.info(
            f"Queuing {len(next_stage_keys)} next stages after {current_stage_key}: "
            f"{', '.join(next_stage_keys)}"
        )

        # Queue all next stages
        for next_stage_key in next_stage_keys:
            await self._queue_stage(
                run_id=completed_job.run_id,
                project_id=completed_job.project_id,
                doc_id=completed_job.doc_id,
                stage_key=next_stage_key,
                previous_output=output,
                previous_input=completed_job.input_json,
                pipeline_config=pipeline_config
            )

    async def _queue_stage(
        self,
        run_id: UUID,
        project_id: Optional[UUID],
        doc_id: Optional[UUID],
        stage_key: str,
        previous_output: Dict[str, Any],
        previous_input: Dict[str, Any],
        pipeline_config: PipelineDefinition
    ):
        """
        Queue a single stage

        Merges previous output into next stage input
        """
        # Get stage config
        if stage_key not in pipeline_config.stages:
            logger.error(f"Cannot queue unknown stage: {stage_key}")
            return

        stage_config = pipeline_config.stages[stage_key]

        # Merge previous output into next stage input
        # Previous output becomes available to next stage
        next_input = {
            **previous_input,  # Carry forward original inputs
            **previous_output,  # Add outputs from previous stage
            "project_id": str(project_id) if project_id else None,
            "doc_id": str(doc_id) if doc_id else None
        }

        # Insert job (ON CONFLICT DO NOTHING prevents duplicates)
        job_id = await self.db.fetchval("""
            INSERT INTO pf_jobs (
                run_id, project_id, doc_id, stage_key,
                status, input_json, max_attempts
            )
            VALUES ($1, $2, $3, $4, 'queued', $5, $6)
            ON CONFLICT (run_id, doc_id, stage_key) DO NOTHING
            RETURNING id
        """,
            run_id,
            project_id,
            doc_id,
            stage_key,
            json.dumps(next_input),
            stage_config.max_retries
        )

        if job_id:
            logger.info(
                f"Queued job {job_id} for stage {stage_key} "
                f"(run={run_id}, doc={doc_id})"
            )
        else:
            logger.debug(
                f"Job already exists for stage {stage_key} "
                f"(run={run_id}, doc={doc_id})"
            )

    async def get_pipeline_config(self, run_id: UUID) -> PipelineDefinition:
        """
        Get pipeline configuration for a run

        Args:
            run_id: Pipeline run ID

        Returns:
            PipelineDefinition object
        """
        row = await self.db.fetchrow("""
            SELECT pipeline_config_snapshot
            FROM pf_runs
            WHERE id = $1
        """, run_id)

        if not row:
            raise ValueError(f"Pipeline run {run_id} not found")

        config_data = json.loads(row["pipeline_config_snapshot"])
        return PipelineDefinition.from_dict(config_data)

    async def check_dependencies_met(
        self,
        run_id: UUID,
        doc_id: UUID,
        stage_key: str,
        pipeline_config: PipelineDefinition
    ) -> bool:
        """
        Check if all parent stages for this stage have completed
        (For DAG pipelines with wait_for_all=True)

        Args:
            run_id: Pipeline run ID
            doc_id: Document ID
            stage_key: Stage to check
            pipeline_config: Pipeline configuration

        Returns:
            True if all dependencies are met
        """
        # For linear pipelines, dependencies are always met
        if pipeline_config.type == "linear":
            return True

        # Find all parent stages (stages that list this stage in their 'next')
        parent_stages = []
        for key, config in pipeline_config.stages.items():
            if stage_key in config.next_stages:
                parent_stages.append(key)

        if not parent_stages:
            # No parents, dependencies met
            return True

        # Check if all parent jobs are complete
        for parent_stage in parent_stages:
            row = await self.db.fetchrow("""
                SELECT status
                FROM pf_jobs
                WHERE run_id = $1 AND doc_id = $2 AND stage_key = $3
            """, run_id, doc_id, parent_stage)

            if not row or row["status"] != "done":
                logger.debug(
                    f"Dependency not met: {parent_stage} for {stage_key} "
                    f"(run={run_id}, doc={doc_id})"
                )
                return False

        logger.info(
            f"All dependencies met for {stage_key} "
            f"(run={run_id}, doc={doc_id})"
        )
        return True
