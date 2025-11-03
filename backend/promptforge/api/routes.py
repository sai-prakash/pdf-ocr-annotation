"""
FastAPI routes for pipeline operations
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel
import logging
import shutil
from pathlib import Path
import tempfile

from ..orchestrator.pipeline_manager import PipelineManager
from ..infra.db import get_db, DatabaseManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/pipeline", tags=["pipeline"])


# ============================================================================
# Request/Response Models
# ============================================================================

class PipelineRunRequest(BaseModel):
    """Request model for creating a pipeline run"""
    project_id: Optional[UUID] = None
    pipeline_version: str = "1.0.0"


class BulkUploadRequest(BaseModel):
    """Request model for bulk upload"""
    project_id: Optional[UUID] = None
    pipeline_version: str = "1.0.0"


class PipelineRunResponse(BaseModel):
    """Response model for pipeline run creation"""
    run_id: UUID
    doc_id: Optional[UUID] = None
    status: str
    message: str


class RunStatusResponse(BaseModel):
    """Response model for run status"""
    id: UUID
    project_id: Optional[UUID]
    run_status: str
    started_at: str
    finished_at: Optional[str]
    total_jobs: int
    current_jobs: int
    completed: int
    failed: int
    running: int
    queued: int


# ============================================================================
# Endpoints
# ============================================================================

@router.post("/run", response_model=PipelineRunResponse)
async def create_pipeline_run(
    file: UploadFile = File(...),
    project_id: Optional[str] = None,
    pipeline_version: str = "1.0.0",
    db: DatabaseManager = Depends(get_db)
):
    """
    Upload document and start pipeline processing

    - **file**: PDF file to process
    - **project_id**: Optional project ID
    - **pipeline_version**: Pipeline configuration version (default: 1.0.0)
    """
    try:
        # Validate file type
        if not file.filename.endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")

        logger.info(f"Received pipeline run request: file={file.filename}, project={project_id}")

        # Save file temporarily
        from uuid import uuid4
        doc_id = uuid4()

        # Create temp file
        temp_dir = Path(tempfile.gettempdir()) / "promptforge_uploads"
        temp_dir.mkdir(exist_ok=True)

        temp_path = temp_dir / f"{doc_id}.pdf"

        with temp_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        logger.info(f"Saved temp file: {temp_path}")

        # Submit to pipeline
        manager = PipelineManager(db)

        project_uuid = UUID(project_id) if project_id else None

        run_id = await manager.submit_pipeline_run(
            project_id=project_uuid,
            doc_id=doc_id,
            pipeline_version=pipeline_version,
            input_data={
                "file_path": str(temp_path),
                "original_filename": file.filename
            }
        )

        logger.info(f"Created pipeline run: run_id={run_id}, doc_id={doc_id}")

        return PipelineRunResponse(
            run_id=run_id,
            doc_id=doc_id,
            status="queued",
            message="Pipeline started successfully"
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating pipeline run: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error creating pipeline run: {str(e)}")


@router.post("/bulk-upload")
async def bulk_upload(
    files: List[UploadFile] = File(...),
    project_id: Optional[str] = None,
    pipeline_version: str = "1.0.0",
    db: DatabaseManager = Depends(get_db)
):
    """
    Bulk upload multiple documents

    - **files**: List of PDF files to process
    - **project_id**: Optional project ID
    - **pipeline_version**: Pipeline configuration version
    """
    try:
        if len(files) > 100:
            raise HTTPException(status_code=400, detail="Maximum 100 files per batch")

        logger.info(f"Received bulk upload: {len(files)} files, project={project_id}")

        # Save files and collect doc IDs
        from uuid import uuid4
        doc_ids = []
        input_data_per_doc = {}

        temp_dir = Path(tempfile.gettempdir()) / "promptforge_uploads"
        temp_dir.mkdir(exist_ok=True)

        for file in files:
            if not file.filename.endswith('.pdf'):
                raise HTTPException(status_code=400, detail=f"Invalid file type: {file.filename}")

            doc_id = uuid4()
            temp_path = temp_dir / f"{doc_id}.pdf"

            with temp_path.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            doc_ids.append(doc_id)
            input_data_per_doc[doc_id] = {
                "file_path": str(temp_path),
                "original_filename": file.filename
            }

        # Bulk submit to pipeline
        manager = PipelineManager(db)
        project_uuid = UUID(project_id) if project_id else None

        run_id = await manager.bulk_submit(
            project_id=project_uuid,
            doc_ids=doc_ids,
            pipeline_version=pipeline_version,
            input_data_per_doc=input_data_per_doc
        )

        logger.info(f"Created bulk pipeline run: run_id={run_id}, docs={len(doc_ids)}")

        return {
            "run_id": run_id,
            "queued_count": len(doc_ids),
            "doc_ids": [str(d) for d in doc_ids],
            "status": "processing"
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in bulk upload: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/runs/{run_id}/status", response_model=RunStatusResponse)
async def get_run_status(
    run_id: UUID,
    db: DatabaseManager = Depends(get_db)
):
    """
    Get pipeline run summary

    - **run_id**: Pipeline run ID
    """
    try:
        manager = PipelineManager(db)
        status = await manager.get_run_status(run_id)

        if not status:
            raise HTTPException(status_code=404, detail="Run not found")

        # Convert datetime objects to strings
        status_copy = dict(status)
        if status_copy.get("started_at"):
            status_copy["started_at"] = status_copy["started_at"].isoformat()
        if status_copy.get("finished_at"):
            status_copy["finished_at"] = status_copy["finished_at"].isoformat()

        return RunStatusResponse(**status_copy)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching run status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/runs/{run_id}/jobs")
async def get_run_jobs(
    run_id: UUID,
    status: Optional[str] = None,
    db: DatabaseManager = Depends(get_db)
):
    """
    Get detailed job list for a run

    - **run_id**: Pipeline run ID
    - **status**: Optional status filter (queued, running, done, failed)
    """
    try:
        manager = PipelineManager(db)
        jobs = await manager.get_run_jobs(run_id, status)

        # Convert datetime objects to strings
        for job in jobs:
            if job.get("created_at"):
                job["created_at"] = job["created_at"].isoformat()
            if job.get("updated_at"):
                job["updated_at"] = job["updated_at"].isoformat()

        return {"jobs": jobs}

    except Exception as e:
        logger.error(f"Error fetching run jobs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dlq")
async def get_dlq(
    project_id: Optional[UUID] = None,
    limit: int = 50,
    db: DatabaseManager = Depends(get_db)
):
    """
    Get dead letter queue entries

    - **project_id**: Optional project filter
    - **limit**: Maximum number of entries (default: 50)
    """
    try:
        if project_id:
            jobs = await db.fetch("""
                SELECT
                  d.original_job_id, d.doc_id, d.stage_key,
                  d.error_msg, d.error_category, d.moved_to_dlq_at
                FROM pf_jobs_dlq d
                WHERE d.project_id = $1
                ORDER BY d.moved_to_dlq_at DESC
                LIMIT $2
            """, project_id, limit)
        else:
            jobs = await db.fetch("""
                SELECT
                  d.original_job_id, d.doc_id, d.stage_key,
                  d.error_msg, d.error_category, d.moved_to_dlq_at
                FROM pf_jobs_dlq d
                ORDER BY d.moved_to_dlq_at DESC
                LIMIT $1
            """, limit)

        # Convert to dicts and format timestamps
        result = []
        for job in jobs:
            job_dict = dict(job)
            if job_dict.get("moved_to_dlq_at"):
                job_dict["moved_to_dlq_at"] = job_dict["moved_to_dlq_at"].isoformat()
            result.append(job_dict)

        return {"dlq_entries": result}

    except Exception as e:
        logger.error(f"Error fetching DLQ: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check(db: DatabaseManager = Depends(get_db)):
    """
    Health probe for monitoring

    Returns database connection status and active worker count
    """
    try:
        # Check DB connection
        await db.fetchval("SELECT 1")
        db_healthy = True
    except:
        db_healthy = False

    # Check active workers
    try:
        active_workers = await db.fetchval("""
            SELECT COUNT(DISTINCT leased_by)
            FROM pf_jobs
            WHERE status = 'running'
              AND heartbeat_at > NOW() - INTERVAL '2 minutes'
        """) or 0
    except:
        active_workers = 0

    from datetime import datetime
    return {
        "status": "healthy" if db_healthy else "unhealthy",
        "database": "connected" if db_healthy else "disconnected",
        "active_workers": active_workers,
        "timestamp": datetime.utcnow().isoformat()
    }
