"""
Pipeline Manager - manages pipeline run lifecycle
"""
import json
from uuid import UUID, uuid4
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging
from ..models.domain import PipelineDefinition, PipelineRun, RunStatus
from .dag_executor import DAGExecutor
from .job_queue import JobQueue

logger = logging.getLogger(__name__)


class PipelineManager:
    """Manages pipeline run lifecycle"""

    def __init__(self, db):
        self.db = db
        self.dag_executor = DAGExecutor(db)

    async def submit_pipeline_run(
        self,
        project_id: Optional[UUID],
        doc_id: UUID,
        pipeline_version: str = "1.0.0",
        input_data: Optional[Dict[str, Any]] = None
    ) -> UUID:
        """
        Create a new pipeline run and queue initial jobs

        Args:
            project_id: Project ID
            doc_id: Document ID
            pipeline_version: Pipeline configuration version to use
            input_data: Optional initial input data

        Returns:
            Pipeline run ID
        """
        # Fetch and validate pipeline config
        config = await self.fetch_pipeline_config(project_id, pipeline_version)

        if not config:
            raise ValueError(
                f"Pipeline config not found: project={project_id}, version={pipeline_version}"
            )

        # Create run record
        run_id = uuid4()

        await self.db.execute("""
            INSERT INTO pf_runs (
                id, project_id, pipeline_config_version,
                pipeline_config_snapshot, status, total_jobs
            )
            VALUES ($1, $2, $3, $4, 'running', 1)
        """, run_id, project_id, pipeline_version, json.dumps(config.to_dict()))

        # Prepare initial input
        initial_input = {
            "project_id": str(project_id) if project_id else None,
            "doc_id": str(doc_id),
            **(input_data or {})
        }

        # Queue entry stage job
        entry_stage = config.entry_stage
        entry_stage_config = config.stages[entry_stage]

        await self.db.execute("""
            INSERT INTO pf_jobs (
                run_id, project_id, doc_id, stage_key,
                status, input_json, max_attempts
            )
            VALUES ($1, $2, $3, $4, 'queued', $5, $6)
        """,
            run_id,
            project_id,
            doc_id,
            entry_stage,
            json.dumps(initial_input),
            entry_stage_config.max_retries
        )

        logger.info(
            f"Created pipeline run {run_id} for doc={doc_id}, "
            f"entry_stage={entry_stage}"
        )

        return run_id

    async def bulk_submit(
        self,
        project_id: Optional[UUID],
        doc_ids: List[UUID],
        pipeline_version: str = "1.0.0",
        input_data_per_doc: Optional[Dict[UUID, Dict[str, Any]]] = None
    ) -> UUID:
        """
        Bulk upload: single run, multiple docs

        Args:
            project_id: Project ID
            doc_ids: List of document IDs
            pipeline_version: Pipeline configuration version
            input_data_per_doc: Optional dict mapping doc_id to input data

        Returns:
            Pipeline run ID
        """
        config = await self.fetch_pipeline_config(project_id, pipeline_version)

        if not config:
            raise ValueError(
                f"Pipeline config not found: project={project_id}, version={pipeline_version}"
            )

        run_id = uuid4()

        async with self.db.transaction() as conn:
            # Create run
            await conn.execute("""
                INSERT INTO pf_runs (
                    id, project_id, pipeline_config_version,
                    pipeline_config_snapshot, status, total_jobs
                )
                VALUES ($1, $2, $3, $4, 'running', $5)
            """, run_id, project_id, pipeline_version,
                json.dumps(config.to_dict()), len(doc_ids))

            # Prepare jobs
            entry_stage = config.entry_stage
            entry_stage_config = config.stages[entry_stage]

            jobs = []
            for doc_id in doc_ids:
                # Get doc-specific input if provided
                doc_input = input_data_per_doc.get(doc_id, {}) if input_data_per_doc else {}

                initial_input = {
                    "project_id": str(project_id) if project_id else None,
                    "doc_id": str(doc_id),
                    **doc_input
                }

                jobs.append((
                    run_id,
                    project_id,
                    doc_id,
                    entry_stage,
                    "queued",
                    json.dumps(initial_input),
                    entry_stage_config.max_retries
                ))

            # Bulk insert jobs
            await conn.executemany("""
                INSERT INTO pf_jobs (
                    run_id, project_id, doc_id, stage_key,
                    status, input_json, max_attempts
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, jobs)

        logger.info(
            f"Created bulk pipeline run {run_id} with {len(doc_ids)} documents"
        )

        return run_id

    async def fetch_pipeline_config(
        self,
        project_id: Optional[UUID],
        version: str
    ) -> Optional[PipelineDefinition]:
        """
        Fetch pipeline configuration

        Args:
            project_id: Project ID (None for global config)
            version: Configuration version

        Returns:
            PipelineDefinition or None if not found
        """
        # Try project-specific config first, then global
        row = await self.db.fetchrow("""
            SELECT config_json
            FROM pf_pipeline_configs
            WHERE (project_id = $1 OR project_id IS NULL)
              AND version = $2
              AND is_active = TRUE
            ORDER BY project_id NULLS LAST
            LIMIT 1
        """, project_id, version)

        if not row:
            return None

        config_data = json.loads(row["config_json"])
        return PipelineDefinition.from_dict(config_data)

    async def get_run_status(self, run_id: UUID) -> Optional[Dict[str, Any]]:
        """
        Get pipeline run summary

        Args:
            run_id: Pipeline run ID

        Returns:
            Run status dictionary
        """
        run = await self.db.fetchrow("""
            SELECT
              r.id,
              r.project_id,
              r.status as run_status,
              r.started_at,
              r.finished_at,
              r.total_jobs,
              COUNT(*) as current_jobs,
              COUNT(*) FILTER (WHERE j.status = 'done') as completed,
              COUNT(*) FILTER (WHERE j.status = 'failed') as failed,
              COUNT(*) FILTER (WHERE j.status = 'running') as running,
              COUNT(*) FILTER (WHERE j.status = 'queued') as queued
            FROM pf_runs r
            LEFT JOIN pf_jobs j ON j.run_id = r.id
            WHERE r.id = $1
            GROUP BY r.id, r.project_id, r.status, r.started_at, r.finished_at, r.total_jobs
        """, run_id)

        if not run:
            return None

        return dict(run)

    async def get_run_jobs(
        self,
        run_id: UUID,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get detailed job list for a run

        Args:
            run_id: Pipeline run ID
            status: Optional status filter

        Returns:
            List of job dictionaries
        """
        if status:
            jobs = await self.db.fetch("""
                SELECT
                  j.id, j.doc_id, j.stage_key, j.status,
                  j.attempts, j.error_msg, j.created_at, j.updated_at
                FROM pf_jobs j
                WHERE j.run_id = $1 AND j.status = $2
                ORDER BY j.created_at DESC
            """, run_id, status)
        else:
            jobs = await self.db.fetch("""
                SELECT
                  j.id, j.doc_id, j.stage_key, j.status,
                  j.attempts, j.error_msg, j.created_at, j.updated_at
                FROM pf_jobs j
                WHERE j.run_id = $1
                ORDER BY j.created_at DESC
            """, run_id)

        return [dict(job) for job in jobs]

    async def save_pipeline_config(
        self,
        config: PipelineDefinition,
        project_id: Optional[UUID] = None,
        created_by: Optional[UUID] = None,
        set_active: bool = True
    ) -> int:
        """
        Save a pipeline configuration

        Args:
            config: Pipeline configuration
            project_id: Project ID (None for global)
            created_by: User ID who created the config
            set_active: Whether to set this as the active config

        Returns:
            Config ID
        """
        # Deactivate other configs if setting this as active
        if set_active:
            await self.db.execute("""
                UPDATE pf_pipeline_configs
                SET is_active = FALSE
                WHERE project_id = $1 OR (project_id IS NULL AND $1 IS NULL)
            """, project_id)

        # Insert new config
        config_id = await self.db.fetchval("""
            INSERT INTO pf_pipeline_configs (
                project_id, version, config_json, is_active, created_by
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (project_id, version) DO UPDATE
            SET config_json = EXCLUDED.config_json,
                is_active = EXCLUDED.is_active,
                created_at = NOW()
            RETURNING id
        """, project_id, config.version, json.dumps(config.to_dict()),
            set_active, created_by)

        logger.info(
            f"Saved pipeline config: id={config_id}, "
            f"version={config.version}, active={set_active}"
        )

        return config_id
