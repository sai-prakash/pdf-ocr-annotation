PromptForge — Pipeline Orchestration Infrastructure (v4.1: Production-Ready Spec)
0 | Executive Summary
Purpose: Build a configurable, DAG-driven orchestration layer for document processing that scales to 100-500 documents without provisioning additional AWS infrastructure.

Current Flow:

Document upload → S3 → OCR (EasyOCR/Tesseract) → Classification (LLM) → Auto-Annotation (LLM) → Review UI
```

**New System:**
- Asynchronous pipeline execution with retries, exponential backoff, DLQ, and watchdog recovery
- Postgres-based job queue (no SQS/Redis)
- Backward-compatible with existing API endpoints
- Horizontally scalable via ECS task count

---

## 1 | Current Stack

| Layer | Technology |
|-------|------------|
| Web API | FastAPI (Python 3.10+) |
| Database | PostgreSQL 14+ (asyncpg / SQLAlchemy 2.0) |
| Storage | AWS S3 |
| AI | Azure OpenAI (GPT-4o, GPT-4o-mini) |
| OCR | EasyOCR / Tesseract |
| Deployment | AWS ECS Fargate (monolithic container) |

**Hard Constraints:**
- No new AWS services (no SQS, ElastiCache, Step Functions, etc.)
- Must use existing S3, RDS Postgres, ECS infrastructure
- Connection pool limit: 15 max connections to RDS

---

## 2 | System Architecture

### 2.1 Deployment Model

**Modular Monolith** — Single Docker image, 3 process types:
```
┌─────────────────────────────────────────┐
│         Single Docker Image             │
├─────────────────────────────────────────┤
│  Process 1: API Server (FastAPI)        │  ← ECS Task × 2 replicas
│  Process 2: Worker (async executor)     │  ← ECS Task × 4 replicas
│  Process 3: Scheduler (watchdog/DLQ)    │  ← ECS Task × 1 replica
└─────────────────────────────────────────┘
ECS Task Definitions:

yaml
# task-definition-api.json
{
  "containerDefinitions": [{
    "command": ["python", "-m", "promptforge.api"],
    "cpu": 512,
    "memory": 1024
  }]
}

# task-definition-worker.json
{
  "containerDefinitions": [{
    "command": ["python", "-m", "promptforge.workers.loop"],
    "cpu": 1024,
    "memory": 2048
  }]
}

# task-definition-scheduler.json
{
  "containerDefinitions": [{
    "command": ["python", "-m", "promptforge.scheduler.watchdog"],
    "cpu": 256,
    "memory": 512
  }]
}
```

### 2.2 Architecture Layers (Hexagonal Pattern)
```
┌──────────────────────────────────────────────────────┐
│                  API Layer (FastAPI)                  │
└────────────────────┬─────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────┐
│            Orchestrator (Core Domain)                 │
│  - PipelineManager                                    │
│  - DAGExecutor                                        │
│  - JobQueue                                           │
│  - RetryPolicy                                        │
│  - Heartbeat                                          │
└────────────┬──────────────────────┬──────────────────┘
             │                      │
    ┌────────▼────────┐    ┌───────▼──────────┐
    │  Stage Registry │    │ Adapters Factory │
    │  (Strategies)   │    │  (Ports)         │
    └────────┬────────┘    └───────┬──────────┘
             │                      │
    ┌────────▼────────┐    ┌───────▼──────────┐
    │  Stage Impls    │    │  Adapter Impls   │
    │  - UploadStage  │    │  - S3Adapter     │
    │  - ExtractStage │    │  - EasyOCRAdptr  │
    │  - ClassifyStg  │    │  - AzureLLMAdptr │
    │  - AnnotateStg  │    │  - MockAdapters  │
    └─────────────────┘    └──────────────────┘
3 | Pipeline Definition
3.1 JSON Configuration Format
Linear Pipeline (v1.0 — Start Here):

json
{
  "name": "DocAI_Pipeline",
  "version": "1.0.0",
  "type": "linear",
  "entry_stage": "upload",
  "stages": {
    "upload": {
      "next": ["extract_text"],
      "timeout_seconds": 60,
      "max_retries": 3
    },
    "extract_text": {
      "next": ["classify_doc"],
      "timeout_seconds": 180,
      "max_retries": 3
    },
    "classify_doc": {
      "next": ["auto_annotate"],
      "timeout_seconds": 90,
      "max_retries": 3
    },
    "auto_annotate": {
      "next": [],
      "timeout_seconds": 300,
      "max_retries": 3
    }
  },
  "limits": {
    "max_concurrent_runs_per_project": 10
  },
  "policy": {
    "allowed_models": ["gpt-4o", "gpt-4o-mini"],
    "max_temperature": 0.2
  }
}
Parallel Pipeline (Future v2.0 — Optional):

json
{
  "type": "dag",
  "stages": {
    "upload": {
      "next": ["extract_text", "extract_metadata"]
    },
    "extract_text": {
      "next": ["classify_doc"]
    },
    "extract_metadata": {
      "next": ["classify_doc"]
    },
    "classify_doc": {
      "next": ["auto_annotate"],
      "wait_for_all": true
    }
  }
}
3.2 Storage Location
sql
CREATE TABLE pf_pipeline_configs (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  version TEXT NOT NULL,
  config_json JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, version)
);

CREATE INDEX idx_pipeline_configs_active ON pf_pipeline_configs(project_id, is_active) WHERE is_active = TRUE;
4 | Database Schema
4.1 Core Tables
sql
-- ============================================================================
-- Pipeline Runs
-- ============================================================================
CREATE TABLE pf_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_config_version TEXT NOT NULL,
  pipeline_config_snapshot JSONB NOT NULL,  -- Immutable config copy
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed', 'partial')),
  total_jobs INT DEFAULT 0,
  completed_jobs INT DEFAULT 0,
  failed_jobs INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_runs_project ON pf_runs(project_id, created_at DESC);
CREATE INDEX idx_runs_status ON pf_runs(status, started_at) WHERE status = 'running';

-- ============================================================================
-- Jobs Queue (Heart of the System)
-- ============================================================================
CREATE TABLE pf_jobs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES pf_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  
  -- Job State
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  not_before TIMESTAMPTZ DEFAULT NOW(),  -- For exponential backoff
  
  -- Lease Management (for distributed workers)
  leased_by TEXT,          -- Worker ID
  leased_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  version INT DEFAULT 1,   -- For optimistic locking
  
  -- Input/Output
  input_json JSONB,
  output_json JSONB,
  
  -- Error Tracking
  error_code TEXT,
  error_msg TEXT,
  error_category TEXT CHECK (error_category IN ('transient', 'permanent', 'throttle', 'config')),
  
  -- Cost Tracking (Azure OpenAI)
  llm_tokens_used INT,
  llm_cost_usd DECIMAL(10, 4),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate jobs for same run+doc+stage
  CONSTRAINT uniq_job_per_stage UNIQUE(run_id, doc_id, stage_key)
);

-- ============================================================================
-- CRITICAL INDEXES (Required for Performance)
-- ============================================================================

-- Queue scanning (workers lease next job)
CREATE INDEX idx_jobs_queue ON pf_jobs(not_before, id) 
  WHERE status = 'queued';

-- Watchdog queries (find stale jobs)
CREATE INDEX idx_jobs_heartbeat ON pf_jobs(status, heartbeat_at)
  WHERE status = 'running';

-- Foreign key lookups
CREATE INDEX idx_jobs_run_id ON pf_jobs(run_id);
CREATE INDEX idx_jobs_doc_id ON pf_jobs(doc_id);
CREATE INDEX idx_jobs_project_id ON pf_jobs(project_id);

-- Status monitoring
CREATE INDEX idx_jobs_status_updated ON pf_jobs(status, updated_at);

-- ============================================================================
-- Dead Letter Queue
-- ============================================================================
CREATE TABLE pf_jobs_dlq (
  LIKE pf_jobs INCLUDING ALL,
  moved_to_dlq_at TIMESTAMPTZ DEFAULT NOW(),
  original_job_id BIGINT NOT NULL
);

CREATE INDEX idx_dlq_moved_at ON pf_jobs_dlq(moved_to_dlq_at DESC);

-- ============================================================================
-- Idempotency Cache
-- ============================================================================
CREATE TABLE pf_idem (
  run_id UUID NOT NULL,
  stage_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_json JSONB,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  PRIMARY KEY (run_id, stage_key, input_hash)
);

CREATE INDEX idx_idem_expiry ON pf_idem(expires_at);

-- ============================================================================
-- Archive Table (for old completed jobs)
-- ============================================================================
CREATE TABLE pf_jobs_archive (
  LIKE pf_jobs INCLUDING ALL,
  archived_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_archive_created ON pf_jobs_archive(created_at DESC);
4.2 Job Lease Query (Core Algorithm)
sql
-- Worker leases next available job
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
  leased_by = $1,           -- worker_id
  leased_at = NOW(),
  heartbeat_at = NOW(),
  version = version + 1,    -- Increment for optimistic locking
  updated_at = NOW()
FROM cte 
WHERE j.id = cte.id 
RETURNING 
  j.id, j.run_id, j.doc_id, j.stage_key, 
  j.input_json, j.attempts, j.max_attempts, j.version;
5 | Stage Specifications
5.1 Stage Interface
python
# stages/base.py

from abc import ABC, abstractmethod
from typing import Dict, Any

class StageResult:
    def __init__(self, success: bool, output: Dict[str, Any], error: Optional[Exception] = None):
        self.success = success
        self.output = output
        self.error = error

class BaseStage(ABC):
    """Abstract base class for all pipeline stages"""
    
    @abstractmethod
    async def execute(self, input_data: Dict[str, Any]) -> StageResult:
        """Execute the stage logic"""
        pass
    
    @abstractmethod
    def get_stage_key(self) -> str:
        """Return unique stage identifier"""
        pass
    
    def get_timeout_seconds(self) -> int:
        """Override to set custom timeout"""
        return 300  # 5 minutes default
5.2 Stage Implementations
A. Upload Stage
Input: {"file_path": "/tmp/upload.pdf", "original_filename": "contract.pdf"}

Output: {"s3_key": "projects/{project_id}/docs/{doc_id}/original.pdf", "file_size_bytes": 1234567}

Implementation:

python
# stages/upload_stage.py

class UploadStage(BaseStage):
    def __init__(self, s3_adapter: S3Adapter):
        self.s3 = s3_adapter
    
    async def execute(self, input_data: Dict[str, Any]) -> StageResult:
        try:
            file_path = input_data["file_path"]
            project_id = input_data["project_id"]
            doc_id = input_data["doc_id"]
            
            s3_key = f"projects/{project_id}/docs/{doc_id}/original.pdf"
            await self.s3.upload_file(file_path, s3_key)
            
            file_size = os.path.getsize(file_path)
            
            return StageResult(
                success=True,
                output={"s3_key": s3_key, "file_size_bytes": file_size}
            )
        except Exception as e:
            return StageResult(success=False, output={}, error=e)
    
    def get_stage_key(self) -> str:
        return "upload"
B. Extract Text Stage (OCR)
Input: {"s3_key": "projects/.../original.pdf"}

Output: {"ocr_json_s3_key": "projects/.../ocr_results.json", "page_count": 5}

OCR JSON Format:

json
{
  "pages": [
    {
      "page": 1,
      "lines": [
        {
          "bbox": [12, 45, 180, 60],
          "text": "GOVERNING LAW: NEW YORK",
          "confidence": 0.95
        }
      ]
    }
  ]
}
Implementation:

python
# stages/extract_stage.py

class ExtractTextStage(BaseStage):
    def __init__(self, s3_adapter: S3Adapter, ocr_adapter: EasyOCRAdapter):
        self.s3 = s3_adapter
        self.ocr = ocr_adapter
    
    async def execute(self, input_data: Dict[str, Any]) -> StageResult:
        try:
            # Download file from S3
            s3_key = input_data["s3_key"]
            local_path = await self.s3.download_to_temp(s3_key)
            
            # Run OCR
            ocr_results = await self.ocr.extract_text(local_path)
            
            # Save OCR JSON to S3
            ocr_json_s3_key = s3_key.replace("original.pdf", "ocr_results.json")
            await self.s3.upload_json(ocr_results, ocr_json_s3_key)
            
            # Update documents table
            await self.update_document(
                input_data["doc_id"],
                ocr_json_s3_key=ocr_json_s3_key
            )
            
            return StageResult(
                success=True,
                output={
                    "ocr_json_s3_key": ocr_json_s3_key,
                    "page_count": len(ocr_results["pages"])
                }
            )
        except Exception as e:
            return StageResult(success=False, output={}, error=e)
    
    def get_stage_key(self) -> str:
        return "extract_text"
C. Classify Document Stage
Input: {"ocr_json_s3_key": "projects/.../ocr_results.json"}

Output: {"doc_type": "employment_agreement", "fields": ["employee_name", "start_date", "salary", "governing_law"]}

Implementation:

python
# stages/classify_stage.py

class ClassifyDocStage(BaseStage):
    def __init__(self, s3_adapter: S3Adapter, llm_adapter: AzureLLMAdapter):
        self.s3 = s3_adapter
        self.llm = llm_adapter
    
    async def execute(self, input_data: Dict[str, Any]) -> StageResult:
        try:
            # Load OCR results
            ocr_json = await self.s3.download_json(input_data["ocr_json_s3_key"])
            
            # Extract first page text for classification
            first_page_text = "\n".join(
                line["text"] for line in ocr_json["pages"][0]["lines"]
            )
            
            # LLM classification
            prompt = f"""Analyze this document and determine its type.
            
Document text (first page):
{first_page_text[:2000]}

Respond with JSON:
{{
  "doc_type": "employment_agreement|lease_agreement|purchase_order|...",
  "fields": ["field1", "field2", ...]
}}
"""
            
            response = await self.llm.complete(
                prompt=prompt,
                model="gpt-4o-mini",
                temperature=0.1,
                response_format="json"
            )
            
            result = json.loads(response)
            
            # Update documents table
            await self.update_document(
                input_data["doc_id"],
                doc_type=result["doc_type"]
            )
            
            return StageResult(success=True, output=result)
        except Exception as e:
            return StageResult(success=False, output={}, error=e)
    
    def get_stage_key(self) -> str:
        return "classify_doc"
D. Auto-Annotate Stage
Input: {"ocr_json_s3_key": "...", "doc_type": "employment_agreement", "fields": ["employee_name", ...]}

Output: {"annotations_json_s3_key": "projects/.../annotations.json", "field_count": 12}

Annotations JSON Format:

json
{
  "annotations": [
    {
      "field": "employee_name",
      "answer": "John Smith",
      "reasoning": "Found in the header of page 1",
      "contexts": ["Employee Name: John Smith"],
      "page": 1,
      "bbox": [120, 45, 280, 60],
      "confidence": 0.92
    }
  ]
}
Implementation:

python
# stages/annotate_stage.py

class AutoAnnotateStage(BaseStage):
    def __init__(self, s3_adapter: S3Adapter, llm_adapter: AzureLLMAdapter, db):
        self.s3 = s3_adapter
        self.llm = llm_adapter
        self.db = db
    
    async def execute(self, input_data: Dict[str, Any]) -> StageResult:
        try:
            # Load OCR results
            ocr_json = await self.s3.download_json(input_data["ocr_json_s3_key"])
            
            # Fetch field prompts from DB
            field_prompts = await self.fetch_field_prompts(
                input_data["doc_type"],
                input_data["fields"]
            )
            
            # Extract annotations for each field
            annotations = []
            total_tokens = 0
            
            for field_config in field_prompts:
                annotation = await self.extract_field(
                    field_config, 
                    ocr_json
                )
                annotations.append(annotation)
                total_tokens += annotation.get("tokens_used", 0)
            
            # Save annotations to S3
            annotations_json = {"annotations": annotations}
            s3_key = input_data["ocr_json_s3_key"].replace("ocr_results.json", "annotations.json")
            await self.s3.upload_json(annotations_json, s3_key)
            
            # Update documents table
            await self.update_document(
                input_data["doc_id"],
                annotations_json_s3_key=s3_key
            )
            
            return StageResult(
                success=True,
                output={
                    "annotations_json_s3_key": s3_key,
                    "field_count": len(annotations),
                    "llm_tokens_used": total_tokens
                }
            )
        except Exception as e:
            return StageResult(success=False, output={}, error=e)
    
    async def extract_field(self, field_config, ocr_json):
        """Extract single field using LLM"""
        # Build context from OCR
        full_text = self.build_full_text(ocr_json)
        
        prompt = f"""Extract the field '{field_config['name']}' from this document.

{field_config['prompt_template']}

Document text:
{full_text[:4000]}

Respond with JSON:
{{
  "answer": "extracted value or null",
  "reasoning": "why you chose this answer",
  "contexts": ["relevant text snippets"],
  "page": 1,
  "bbox": [x1, y1, x2, y2]
}}
"""
        
        response = await self.llm.complete(
            prompt=prompt,
            model="gpt-4o",
            temperature=0.1,
            response_format="json"
        )
        
        result = json.loads(response)
        result["field"] = field_config["name"]
        result["tokens_used"] = response.get("usage", {}).get("total_tokens", 0)
        
        return result
    
    def get_stage_key(self) -> str:
        return "auto_annotate"
6 | Orchestrator Core Logic
6.1 Pipeline Manager
python
# orchestrator/pipeline_manager.py

class PipelineManager:
    """Manages pipeline run lifecycle"""
    
    def __init__(self, db, stage_registry, dag_executor):
        self.db = db
        self.stages = stage_registry
        self.executor = dag_executor
    
    async def submit_pipeline_run(
        self, 
        project_id: UUID, 
        doc_id: UUID,
        pipeline_version: str = "1.0.0"
    ) -> UUID:
        """Create a new pipeline run and queue initial jobs"""
        
        # Fetch and validate pipeline config
        config = await self.fetch_pipeline_config(project_id, pipeline_version)
        
        # Create run record
        run_id = uuid4()
        await self.db.execute("""
            INSERT INTO pf_runs (id, project_id, pipeline_config_version, pipeline_config_snapshot)
            VALUES ($1, $2, $3, $4)
        """, run_id, project_id, pipeline_version, json.dumps(config))
        
        # Queue entry stage job
        entry_stage = config["entry_stage"]
        await self.create_job(
            run_id=run_id,
            project_id=project_id,
            doc_id=doc_id,
            stage_key=entry_stage,
            input_json={"project_id": str(project_id), "doc_id": str(doc_id)}
        )
        
        return run_id
    
    async def bulk_submit(
        self, 
        project_id: UUID, 
        doc_ids: List[UUID],
        pipeline_version: str = "1.0.0"
    ) -> UUID:
        """Bulk upload: single run, multiple docs"""
        
        config = await self.fetch_pipeline_config(project_id, pipeline_version)
        
        run_id = uuid4()
        
        async with self.db.transaction():
            # Create run
            await self.db.execute("""
                INSERT INTO pf_runs (id, project_id, pipeline_config_version, pipeline_config_snapshot, total_jobs)
                VALUES ($1, $2, $3, $4, $5)
            """, run_id, project_id, pipeline_version, json.dumps(config), len(doc_ids))
            
            # Bulk insert jobs
            jobs = [
                (run_id, project_id, doc_id, config["entry_stage"], "queued", json.dumps({"project_id": str(project_id), "doc_id": str(doc_id)}))
                for doc_id in doc_ids
            ]
            
            await self.db.executemany("""
                INSERT INTO pf_jobs (run_id, project_id, doc_id, stage_key, status, input_json)
                VALUES ($1, $2, $3, $4, $5, $6)
            """, jobs)
        
        return run_id
6.2 Job Queue
python
# orchestrator/job_queue.py

class JobQueue:
    """Manages job leasing and state transitions"""
    
    def __init__(self, db, worker_id: str):
        self.db = db
        self.worker_id = worker_id
    
    async def lease_next_job(self) -> Optional[Job]:
        """Lease next available job using SKIP LOCKED"""
        
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
              j.id, j.run_id, j.doc_id, j.stage_key, 
              j.input_json, j.attempts, j.max_attempts, j.version
        """, self.worker_id)
        
        if not row:
            return None
        
        return Job(**dict(row))
    
    async def heartbeat(self, job_id: int, version: int) -> bool:
        """Update heartbeat with optimistic locking"""
        
        result = await self.db.execute("""
            UPDATE pf_jobs
            SET heartbeat_at = NOW(), version = version + 1, updated_at = NOW()
            WHERE id = $1 AND version = $2 AND status = 'running'
        """, job_id, version)
        
        # Returns True if update succeeded (version matched)
        return result == "UPDATE 1"
    
    async def complete_job(
        self, 
        job_id: int, 
        version: int, 
        output: Dict[str, Any],
        llm_tokens_used: Optional[int] = None
    ):
        """Mark job as done and queue next stages"""
        
        async with self.db.transaction():
            # Update job status
            await self.db.execute("""
                UPDATE pf_jobs
                SET 
                  status = 'done',
                  output_json = $1,
                  llm_tokens_used = $2,
                  version = version + 1,
                  updated_at = NOW()
                WHERE id = $3 AND version = $4
            """, json.dumps(output), llm_tokens_used, job_id, version)
            
            # Get job details
            job = await self.db.fetchrow("""
                SELECT run_id, project_id, doc_id, stage_key
                FROM pf_jobs WHERE id = $1
            """, job_id)
            
            # Queue next stages
            await self.queue_next_stages(job, output)
            
            # Update run progress
            await self.update_run_progress(job["run_id"])
    
    async def fail_job(
        self, 
        job_id: int, 
        version: int,
        error: Exception,
        error_category: str
    ):
        """Mark job as failed and handle retry/DLQ logic"""
        
        job = await self.db.fetchrow("""
            SELECT attempts, max_attempts, run_id, project_id, doc_id, stage_key, input_json
            FROM pf_jobs WHERE id = $1
        """, job_id)
        
        attempts = job["attempts"] + 1
        
        if attempts < job["max_attempts"] and error_category in ["transient", "throttle"]:
            # Retry with exponential backoff
            backoff_seconds = min(2 ** attempts + random.uniform(0, 1), 300)
            
            await self.db.execute("""
                UPDATE pf_jobs
                SET 
                  status = 'queued',
                  attempts = $1,
                  not_before = NOW() + INTERVAL '$2 seconds',
                  error_code = $3,
                  error_msg = $4,
                  error_category = $5,
                  leased_by = NULL,
                  leased_at = NULL,
                  heartbeat_at = NULL,
                  version = version + 1,
                  updated_at = NOW()
                WHERE id = $6 AND version = $7
            """, attempts, backoff_seconds, type(error).__name__, str(error), error_category, job_id, version)
        else:
            # Move to DLQ
            await self.move_to_dlq(job_id, error)
6.3 Retry Policy
python
# orchestrator/retry_policy.py

from enum import Enum

class ErrorCategory(Enum):
    TRANSIENT = "transient"    # Network, timeout → retry
    PERMANENT = "permanent"     # Bad file, parse error → DLQ immediately
    THROTTLE = "throttle"       # Rate limit → retry with longer backoff
    CONFIG = "config"           # Pipeline config error → alert

class RetryPolicy:
    """Determines retry behavior based on error type"""
    
    @staticmethod
    def categorize_error(error: Exception) -> ErrorCategory:
        """Classify error into retry category"""
        
        # Transient errors
        if isinstance(error, (TimeoutError, asyncio.TimeoutError, ConnectionError)):
            return ErrorCategory.TRANSIENT
        
        if isinstance(error, Exception) and "timeout" in str(error).lower():
            return ErrorCategory.TRANSIENT
        
        # Throttling errors
        if isinstance(error, AzureOpenAIThrottleError):
            return ErrorCategory.THROTTLE
        
        if hasattr(error, "status_code") and error.status_code == 429:
            return ErrorCategory.THROTTLE
        
        # Permanent errors
        if isinstance(error, (PDFCorruptError, InvalidFileError, JSONDecodeError)):
            return ErrorCategory.PERMANENT
        
        # Config errors
        if isinstance(error, (PipelineConfigError, StageNotFoundError)):
            return ErrorCategory.CONFIG
        
        # Default: treat as transient
        return ErrorCategory.TRANSIENT
    
    @staticmethod
    def should_retry(error_category: ErrorCategory, attempts: int, max_attempts: int) -> bool:
        """Determine if job should be retried"""
        
        if error_category in [ErrorCategory.PERMANENT, ErrorCategory.CONFIG]:
            return False
        
        return attempts < max_attempts
    
    @staticmethod
    def compute_backoff(attempts: int, error_category: ErrorCategory) -> int:
        """Compute backoff delay in seconds"""
        
        if error_category == ErrorCategory.THROTTLE:
            # Longer backoff for rate limits
            base = min(2 ** attempts, 120)  # Max 2 minutes
        else:
            # Standard exponential backoff
            base = min(2 ** attempts, 60)   # Max 1 minute
        
        # Add jitter
        jitter = random.uniform(0, 1)
        return int(base + jitter)
6.4 DAG Executor
python
# orchestrator/dag_executor.py

class DAGExecutor:
    """Executes DAG logic: queues next stages after job completion"""
    
    def __init__(self, db):
        self.db = db
    
    async def queue_next_stages(
        self, 
        completed_job: Job, 
        output: Dict[str, Any],
        pipeline_config: Dict[str, Any]
    ):
        """Queue next stages in the pipeline"""
        
        current_stage = completed_job.stage_key
        stage_config = pipeline_config["stages"][current_stage]
        
        next_stages = stage_config.get("next", [])
        
        if not next_stages:
            # Terminal stage reached
            return
        
        # Linear pipeline: queue all next stages
        for next_stage_key in next_stages:
            # Merge previous output into next stage input
            next_input = {
                **completed_job.input_json,
                **output
            }
            
            await self.db.execute("""
                INSERT INTO pf_jobs (run_id, project_id, doc_id, stage_key, status, input_json)
                VALUES ($1, $2, $3, $4, 'queued', $5)
                ON CONFLICT (run_id, doc_id, stage_key) DO NOTHING
            """, 
                completed_job.run_id, 
                completed_job.project_id,
                completed_job.doc_id,
                next_stage_key,
                json.dumps(next_input)
            )
6.5 Idempotency Handler
python
# orchestrator/idempotency.py

import hashlib
import json

class IdempotencyCache:
    """Prevents duplicate processing of identical inputs"""
    
    def __init__(self, db):
        self.db = db
    
    @staticmethod
    def compute_hash(input_json: Dict[str, Any]) -> str:
        """Compute deterministic hash of input"""
        canonical = json.dumps(input_json, sort_keys=True, ensure_ascii=True)
        return hashlib.sha256(canonical.encode()).hexdigest()
    
    async def check(self, run_id: UUID, stage_key: str, input_json: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Check if this input was already processed"""
        
        input_hash = self.compute_hash(input_json)
        
        row = await self.db.fetchrow("""
            SELECT output_json
            FROM pf_idem
            WHERE run_id = $1 AND stage_key = $2 AND input_hash = $3
              AND expires_at > NOW()
        """, run_id, stage_key, input_hash)
        
        return json.loads(row["output_json"]) if row else None
    
    async def store(
        self, 
        run_id: UUID, 
        stage_key: str, 
        input_json: Dict[str, Any],
        output_json: Dict[str, Any]
    ):
        """Store successful result for future idempotency checks"""
        
        input_hash = self.compute_hash(input_json)
        
        await self.db.execute("""
            INSERT INTO pf_idem (run_id, stage_key, input_hash, output_json)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (run_id, stage_key, input_hash) DO UPDATE
            SET output_json = EXCLUDED.output_json, processed_at = NOW()
        """, run_id, stage_key, input_hash, json.dumps(output_json))
7 | Worker Loop
python
# workers/loop.py

import asyncio
from typing import Optional

class Worker:
    """Async worker that processes jobs from the queue"""
    
    def __init__(
        self,
        worker_id: str,
        job_queue: JobQueue,
        stage_registry: StageRegistry,
        idempotency_cache: IdempotencyCache,
        max_concurrent_jobs: int = 2
    ):
        self.worker_id = worker_id
        self.queue = job_queue
        self.stages = stage_registry
        self.idem = idempotency_cache
        self.semaphore = asyncio.Semaphore(max_concurrent_jobs)
        self.running = False
    
    async def start(self):
        """Main worker loop"""
        self.running = True
        logger.info(f"Worker {self.worker_id} started")
        
        while self.running:
            try:
                async with self.semaphore:
                    job = await self.queue.lease_next_job()
                    
                    if job:
                        # Process job in background
                        asyncio.create_task(self.process_job(job))
                    else:
                        # No jobs available, backoff
                        await asyncio.sleep(5)
            
            except Exception as e:
                logger.error(f"Worker loop error: {e}")
                await asyncio.sleep(10)
    
    async def process_job(self, job: Job):
        """Process a single job with heartbeat and error handling"""
        
        logger.info(f"Processing job {job.id}: {job.stage_key} for doc {job.doc_id}")
        
        # Start heartbeat task
        heartbeat_task = asyncio.create_task(self.heartbeat_loop(job))
        
        try:
            # Check idempotency
            cached_output = await self.idem.check(job.run_id, job.stage_key, job.input_json)
            if cached_output:
                logger.info(f"Job {job.id} hit idempotency cache")
                await self.queue.complete_job(job.id, job.version, cached_output)
                return
            
            # Get stage implementation
            stage = self.stages.get_stage(job.stage_key)
            
            # Execute with timeout
            timeout = stage.get_timeout_seconds()
            result = await asyncio.wait_for(
                stage.execute(job.input_json),
                timeout=timeout
            )
            
            if result.success:
                # Success path
                await self.idem.store(job.run_id, job.stage_key, job.input_json, result.output)
                await self.queue.complete_job(
                    job.id, 
                    job.version, 
                    result.output,
                    llm_tokens_used=result.output.get("llm_tokens_used")
                )
                logger.info(f"Job {job.id} completed successfully")
            else:
                # Failure path
                error_category = RetryPolicy.categorize_error(result.error)
                await self.queue.fail_job(job.id, job.version, result.error, error_category.value)
                logger.error(f"Job {job.id} failed: {result.error}")
        
        except asyncio.TimeoutError:
            error_category = ErrorCategory.TRANSIENT.value
            await self.queue.fail_job(job.id, job.version, TimeoutError(f"Stage timeout after {timeout}s"), error_category)
        
        except Exception as e:
            error_category = RetryPolicy.categorize_error(e).value
            await self.queue.fail_job(job.id, job.version, e, error_category)
        
        finally:
            # Stop heartbeat
            heartbeat_task.cancel()
    
    async def heartbeat_loop(self, job: Job):
        """Periodically update job heartbeat"""
        version = job.version
        
        while True:
            try:
                await asyncio.sleep(30)  # Heartbeat every 30s
                
                success = await self.queue.heartbeat(job.id, version)
                
                if not success:
                    # Version mismatch: job was stolen or reset
                    logger.warning(f"Job {job.id} heartbeat failed (version mismatch)")
                    break
                
                version += 1  # Increment local version
            
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Heartbeat error for job {job.id}: {e}")
    
    async def stop(self):
        """Graceful shutdown"""
        self.running = False
        logger.info(f"Worker {self.worker_id} stopping")


# Entry point
if __name__ == "__main__":
    worker_id = os.getenv("HOSTNAME", str(uuid4()))
    worker = Worker(worker_id, ...)
    asyncio.run(worker.start())
8 | Scheduler (Watchdog + DLQ)
python
# scheduler/watchdog.py

class Watchdog:
    """Monitors and recovers stuck jobs"""
    
    def __init__(self, db):
        self.db = db
        self.running = False
    
    async def start(self):
        """Main watchdog loop"""
        self.running = True
        logger.info("Watchdog started")
        
        while self.running:
            try:
                await asyncio.sleep(60)  # Run every minute
                
                # Reset stale jobs
                reset_count = await self.reset_stale_jobs()
                if reset_count > 0:
                    logger.warning(f"Watchdog reset {reset_count} stale jobs")
                
                # Clean up expired idempotency cache
                await self.cleanup_idempotency_cache()
                
                # Archive old completed jobs
                await self.archive_old_jobs()
            
            except Exception as e:
                logger.error(f"Watchdog error: {e}")
    
    async def reset_stale_jobs(self) -> int:
        """Reset jobs with stale heartbeats"""
        
        result = await self.db.execute("""
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
              AND heartbeat_at < NOW() - INTERVAL '90 seconds'
        """)
        
        # Extract count from result: "UPDATE N"
        return int(result.split()[-1]) if result else 0
    
    async def cleanup_idempotency_cache(self):
        """Remove expired idempotency entries"""
        
        await self.db.execute("""
            DELETE FROM pf_idem
            WHERE expires_at < NOW()
        """)
    
    async def archive_old_jobs(self):
        """Move old completed jobs to archive table"""
        
        async with self.db.transaction():
            # Copy to archive
            await self.db.execute("""
                INSERT INTO pf_jobs_archive
                SELECT *, NOW() as archived_at
                FROM pf_jobs
                WHERE status IN ('done', 'failed')
                  AND updated_at < NOW() - INTERVAL '30 days'
            """)
            
            # Delete from main table
            result = await self.db.execute("""
                DELETE FROM pf_jobs
                WHERE status IN ('done', 'failed')
                  AND updated_at < NOW() - INTERVAL '30 days'
            """)
            
            if result:
                count = int(result.split()[-1])
                if count > 0:
                    logger.info(f"Archived {count} old jobs")


# Entry point
if __name__ == "__main__":
    watchdog = Watchdog(db)
    asyncio.run(watchdog.start())
9 | API Endpoints
python
# api/routes_pipeline.py

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List

router = APIRouter(prefix="/api/v1", tags=["pipeline"])

@router.post("/pipeline/run")
async def create_pipeline_run(
    project_id: UUID,
    file: UploadFile = File(...),
    pipeline_version: str = "1.0.0",
    use_new_pipeline: bool = True  # Feature flag
):
    """Upload document and start pipeline processing"""
    
    if not use_new_pipeline:
        # Legacy synchronous path
        return await legacy_sync_pipeline(project_id, file)
    
    # Save file temporarily
    doc_id = uuid4()
    temp_path = f"/tmp/{doc_id}.pdf"
    
    with open(temp_path, "wb") as f:
        f.write(await file.read())
    
    # Create document record
    await db.execute("""
        INSERT INTO documents (id, project_id, filename, status)
        VALUES ($1, $2, $3, 'processing')
    """, doc_id, project_id, file.filename)
    
    # Submit to pipeline
    run_id = await pipeline_manager.submit_pipeline_run(
        project_id=project_id,
        doc_id=doc_id,
        pipeline_version=pipeline_version
    )
    
    return {
        "run_id": run_id,
        "doc_id": doc_id,
        "status": "queued",
        "message": "Pipeline started"
    }


@router.post("/pipeline/bulk-upload")
async def bulk_upload(
    project_id: UUID,
    files: List[UploadFile] = File(...),
    pipeline_version: str = "1.0.0"
):
    """Bulk upload multiple documents"""
    
    if len(files) > 100:
        raise HTTPException(400, "Maximum 100 files per batch")
    
    # Save files and create document records
    doc_ids = []
    for file in files:
        doc_id = uuid4()
        temp_path = f"/tmp/{doc_id}.pdf"
        
        with open(temp_path, "wb") as f:
            f.write(await file.read())
        
        await db.execute("""
            INSERT INTO documents (id, project_id, filename, status)
            VALUES ($1, $2, $3, 'processing')
        """, doc_id, project_id, file.filename)
        
        doc_ids.append(doc_id)
    
    # Bulk submit to pipeline
    run_id = await pipeline_manager.bulk_submit(
        project_id=project_id,
        doc_ids=doc_ids,
        pipeline_version=pipeline_version
    )
    
    return {
        "run_id": run_id,
        "queued_count": len(doc_ids),
        "doc_ids": doc_ids,
        "status": "processing"
    }


@router.get("/pipeline/runs/{run_id}/status")
async def get_run_status(run_id: UUID):
    """Get pipeline run summary"""
    
    run = await db.fetchrow("""
        SELECT 
          r.status as run_status,
          r.started_at,
          r.finished_at,
          COUNT(*) as total_jobs,
          COUNT(*) FILTER (WHERE j.status = 'done') as completed,
          COUNT(*) FILTER (WHERE j.status = 'failed') as failed,
          COUNT(*) FILTER (WHERE j.status = 'running') as running,
          COUNT(*) FILTER (WHERE j.status = 'queued') as queued
        FROM pf_runs r
        LEFT JOIN pf_jobs j ON j.run_id = r.id
        WHERE r.id = $1
        GROUP BY r.id, r.status, r.started_at, r.finished_at
    """, run_id)
    
    if not run:
        raise HTTPException(404, "Run not found")
    
    return dict(run)


@router.get("/pipeline/runs/{run_id}/jobs")
async def get_run_jobs(run_id: UUID, status: Optional[str] = None):
    """Get detailed job list for a run"""
    
    query = """
        SELECT 
          j.id, j.doc_id, j.stage_key, j.status, 
          j.attempts, j.error_msg, j.created_at, j.updated_at
        FROM pf_jobs j
        WHERE j.run_id = $1
    """
    
    params = [run_id]
    
    if status:
        query += " AND j.status = $2"
        params.append(status)
    
    query += " ORDER BY j.created_at DESC"
    
    jobs = await db.fetch(query, *params)
    
    return [dict(job) for job in jobs]


@router.get("/pipeline/dlq")
async def get_dlq(project_id: UUID, limit: int = 50):
    """Get dead letter queue entries"""
    
    jobs = await db.fetch("""
        SELECT 
          d.original_job_id, d.doc_id, d.stage_key, 
          d.error_msg, d.error_category, d.moved_to_dlq_at
        FROM pf_jobs_dlq d
        WHERE d.project_id = $1
        ORDER BY d.moved_to_dlq_at DESC
        LIMIT $2
    """, project_id, limit)
    
    return [dict(job) for job in jobs]


@router.get("/health")
async def health_check():
    """Health probe for ECS"""
    
    # Check DB connection
    try:
        await db.fetchval("SELECT 1")
        db_healthy = True
    except:
        db_healthy = False
    
    # Check active workers
    active_workers = await db.fetchval("""
        SELECT COUNT(DISTINCT leased_by)
        FROM pf_jobs
        WHERE status = 'running'
          AND heartbeat_at > NOW() - INTERVAL '2 minutes'
    """)
    
    return {
        "status": "healthy" if db_healthy else "unhealthy",
        "database": "connected" if db_healthy else "disconnected",
        "active_workers": active_workers,
        "timestamp": datetime.now().isoformat()
    }
10 | Adapters (Ports & Implementations)
10.1 S3 Adapter
python
# adapters/s3_adapter.py

import aioboto3
import json

class S3Adapter:
    """Async S3 operations"""
    
    def __init__(self, bucket_name: str):
        self.bucket = bucket_name
        self.session = aioboto3.Session()
    
    async def upload_file(self, local_path: str, s3_key: str):
        """Upload file to S3"""
        async with self.session.client("s3") as s3:
            await s3.upload_file(local_path, self.bucket, s3_key)
    
    async def download_file(self, s3_key: str, local_path: str):
        """Download file from S3"""
        async with self.session.client("s3") as s3:
            await s3.download_file(self.bucket, s3_key, local_path)
    
    async def download_to_temp(self, s3_key: str) -> str:
        """Download to temporary location"""
        temp_path = f"/tmp/{uuid4()}"
        await self.download_file(s3_key, temp_path)
        return temp_path
    
    async def upload_json(self, data: dict, s3_key: str):
        """Upload JSON to S3"""
        json_bytes = json.dumps(data).encode("utf-8")
        async with self.session.client("s3") as s3:
            await s3.put_object(
                Bucket=self.bucket,
                Key=s3_key,
                Body=json_bytes,
                ContentType="application/json"
            )
    
    async def download_json(self, s3_key: str) -> dict:
        """Download and parse JSON from S3"""
        async with self.session.client("s3") as s3:
            response = await s3.get_object(Bucket=self.bucket, Key=s3_key)
            body = await response["Body"].read()
            return json.loads(body.decode("utf-8"))
10.2 Azure OpenAI Adapter
python
# adapters/azure_llm_adapter.py

from openai import AsyncAzureOpenAI
import os

class AzureLLMAdapter:
    """Azure OpenAI wrapper with retry logic"""
    
    def __init__(self):
        self.client = AsyncAzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version="2024-02-01",
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
        )
    
    async def complete(
        self,
        prompt: str,
        model: str = "gpt-4o",
        temperature: float = 0.1,
        max_tokens: int = 2000,
        response_format: str = "text"  # or "json"
    ) -> str:
        """Call Azure OpenAI with retry logic"""
        
        messages = [{"role": "user", "content": prompt}]
        
        kwargs = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        
        if response_format == "json":
            kwargs["response_format"] = {"type": "json_object"}
        
        # Simple retry with exponential backoff
        for attempt in range(3):
            try:
                response = await self.client.chat.completions.create(**kwargs)
                return response.choices[0].message.content
            
            except Exception as e:
                if "429" in str(e) and attempt < 2:
                    # Rate limit: wait and retry
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise AzureOpenAIThrottleError(str(e)) if "429" in str(e) else e
10.3 EasyOCR Adapter
python
# adapters/easyocr_adapter.py

import easyocr
from pdf2image import convert_from_path

class EasyOCRAdapter:
    """OCR extraction using EasyOCR"""
    
    def __init__(self):
        self.reader = easyocr.Reader(['en'], gpu=False)
    
    async def extract_text(self, pdf_path: str) -> dict:
        """Extract text and bounding boxes from PDF"""
        
        # Convert PDF to images
        images = convert_from_path(pdf_path)
        
        results = {"pages": []}
        
        for page_num, image in enumerate(images, start=1):
            # Run OCR on page
            ocr_results = self.reader.readtext(np.array(image))
            
            lines = []
            for (bbox, text, confidence) in ocr_results:
                lines.append({
                    "bbox": [int(coord) for point in bbox for coord in point][:4],
                    "text": text,
                    "confidence": float(confidence)
                })
            
            results["pages"].append({
                "page": page_num,
                "lines": lines
            })
        
        return results
11 | Configuration & Settings
python
# infra/settings.py

from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Database
    DATABASE_URL: str
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 5
    
    # AWS
    AWS_S3_BUCKET: str
    AWS_REGION: str = "us-east-1"
    
    # Azure OpenAI
    AZURE_OPENAI_API_KEY: str
    AZURE_OPENAI_ENDPOINT: str
    
    # Worker
    WORKER_ID: str = None
    WORKER_MAX_CONCURRENT_JOBS: int = 2
    WORKER_HEARTBEAT_INTERVAL: int = 30
    
    # Watchdog
    WATCHDOG_INTERVAL: int = 60
    WATCHDOG_STALE_THRESHOLD: int = 90
    
    # Feature Flags
    USE_NEW_PIPELINE: bool = False
    
    class Config:
        env_file = ".env"

settings = Settings()
python
# infra/db.py

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=False
)

AsyncSessionLocal = sessionmaker(
    engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
```

---

## 12 | Module Structure
```
promptforge/
├── __init__.py
├── api/
│   ├── __init__.py
│   ├── main.py                    # FastAPI app
│   └── routes_pipeline.py         # Pipeline endpoints
├── orchestrator/
│   ├── __init__.py
│   ├── pipeline_manager.py        # Run lifecycle
│   ├── job_queue.py               # Job leasing & state
│   ├── dag_executor.py            # Next-stage queuing
│   ├── retry_policy.py            # Error categorization
│   ├── idempotency.py             # Duplicate detection
│   └── stage_registry.py          # Stage factory
├── stages/
│   ├── __init__.py
│   ├── base.py                    # BaseStage abstract class
│   ├── upload_stage.py
│   ├── extract_stage.py
│   ├── classify_stage.py
│   └── annotate_stage.py
├── adapters/
│   ├── __init__.py
│   ├── s3_adapter.py
│   ├── easyocr_adapter.py
│   ├── azure_llm_adapter.py
│   └── mock_adapters.py           # For testing
├── workers/
│   ├── __init__.py
│   └── loop.py                    # Worker main loop
├── scheduler/
│   ├── __init__.py
│   └── watchdog.py                # Watchdog + DLQ
├── infra/
│   ├── __init__.py
│   ├── db.py                      # SQLAlchemy setup
│   ├── settings.py                # Pydantic settings
│   └── migrations/                # Alembic migrations
│       ├── versions/
│       └── env.py
├── observability/
│   ├── __init__.py
│   ├── logging.py                 # Structured logging
│   └── metrics.py                 # Prometheus metrics (optional)
├── models/
│   ├── __init__.py
│   └── domain.py                  # Dataclasses (Job, Run, etc.)
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
13 | Testing Strategy
13.1 Unit Tests
python
# tests/unit/test_retry_policy.py

def test_categorize_timeout_error():
    error = TimeoutError("Connection timeout")
    category = RetryPolicy.categorize_error(error)
    assert category == ErrorCategory.TRANSIENT

def test_categorize_throttle_error():
    error = AzureOpenAIThrottleError("Rate limit exceeded")
    category = RetryPolicy.categorize_error(error)
    assert category == ErrorCategory.THROTTLE

def test_should_not_retry_permanent_error():
    should_retry = RetryPolicy.should_retry(ErrorCategory.PERMANENT, 1, 3)
    assert should_retry == False
13.2 Integration Tests
python
# tests/integration/test_job_queue.py

@pytest.mark.asyncio
async def test_concurrent_lease_no_duplicate():
    """Two workers should never lease the same job"""
    
    # Create test job
    job_id = await create_test_job()
    
    # Two workers try to lease simultaneously
    worker1 = JobQueue(db, "worker-1")
    worker2 = JobQueue(db, "worker-2")
    
    results = await asyncio.gather(
        worker1.lease_next_job(),
        worker2.lease_next_job(),
        return_exceptions=True
    )
    
    leased_jobs = [r for r in results if isinstance(r, Job)]
    
    # Only one worker should get the job
    assert len(leased_jobs) == 1
    assert leased_jobs[0].id == job_id
13.3 E2E Test
python
# tests/e2e/test_full_pipeline.py

@pytest.mark.asyncio
async def test_full_pipeline_execution():
    """Test complete pipeline: upload → OCR → classify → annotate"""
    
    # Upload document
    response = await client.post(
        "/api/v1/pipeline/run",
        files={"file": open("test_contract.pdf", "rb")},
        data={"project_id": str(project_id)}
    )
    
    run_id = response.json()["run_id"]
    doc_id = response.json()["doc_id"]
    
    # Start workers
    workers = [Worker(f"test-worker-{i}", ...) for i in range(2)]
    worker_tasks = [asyncio.create_task(w.start()) for w in workers]
    
    # Poll for completion
    for _ in range(60):  # Max 5 minutes
        status = await get_run_status(run_id)
        if status["run_status"] == "done":
            break
        await asyncio.sleep(5)
    
    # Stop workers
    for w in workers:
        await w.stop()
    
    # Verify outputs exist
    doc = await db.fetchrow("SELECT * FROM documents WHERE id = $1", doc_id)
    assert doc["ocr_json_s3_key"] is not None
    assert doc["annotations_json_s3_key"] is not None
    assert doc["doc_type"] is not None
    
    # Verify S3 artifacts
    ocr_json = await s3_adapter.download_json(doc["ocr_json_s3_key"])
    assert len(ocr_json["pages"]) > 0
14 | Deployment
14.1 Docker Setup
dockerfile
# Dockerfile

FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libpq-dev \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Default command (override in ECS task definition)
CMD ["python", "-m", "promptforge.api"]
14.2 Docker Compose (Local Development)
yaml
# docker-compose.yml

version: '3.8'

services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: promptforge
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: devpass
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
  
  api:
    build: .
    command: python -m promptforge.api
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql+asyncpg://dev:devpass@postgres:5432/promptforge
      USE_NEW_PIPELINE: "true"
    depends_on:
      - postgres
  
  worker:
    build: .
    command: python -m promptforge.workers.loop
    environment:
      DATABASE_URL: postgresql+asyncpg://dev:devpass@postgres:5432/promptforge
      WORKER_ID: worker-local-1
    depends_on:
      - postgres
  
  scheduler:
    build: .
    command: python -m promptforge.scheduler.watchdog
    environment:
      DATABASE_URL: postgresql+asyncpg://dev:devpass@postgres:5432/promptforge
    depends_on:
      - postgres

volumes:
  pg_data:
14.3 ECS Task Definitions
json
// ecs-task-api.json
{
  "family": "promptforge-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "promptforge:latest",
      "command": ["python", "-m", "promptforge.api"],
      "portMappings": [
        {
          "containerPort": 8000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "USE_NEW_PIPELINE", "value": "true"}
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:..."
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/promptforge-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "api"
        }
      }
    }
  ]
}
15 | Observability
15.1 Structured Logging
python
# observability/logging.py

import logging
import json
from datetime import datetime

class StructuredLogger:
    """JSON structured logging for CloudWatch"""
    
    def __init__(self, name: str):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.INFO)
        
        handler = logging.StreamHandler()
        handler.setFormatter(StructuredFormatter())
        self.logger.addHandler(handler)
    
    def log_job_event(
        self,
        event: str,
        job_id: int,
        run_id: UUID,
        doc_id: UUID,
        stage_key: str,
        **kwargs
    ):
        self.logger.info(
            "",
            extra={
                "event": event,
                "job_id": job_id,
                "run_id": str(run_id),
                "doc_id": str(doc_id),
                "stage_key": stage_key,
                **kwargs
            }
        )

class StructuredFormatter(logging.Formatter):
    def format(self, record):
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
        }
        
        # Add extra fields
        if hasattr(record, "event"):
            log_data.update({
                k: v for k, v in record.__dict__.items()
                if k not in ["name", "msg", "args", "created", "filename", "funcName", "levelname", "levelno", "lineno", "module", "msecs", "message", "pathname", "process", "processName", "relativeCreated", "thread", "threadName"]
            })
        
        return json.dumps(log_data)
15.2 Log Examples
json
{
  "timestamp": "2025-11-01T10:23:45.123Z",
  "level": "INFO",
  "event": "job_leased",
  "job_id": 12345,
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "doc_id": "660e8400-e29b-41d4-a716-446655440001",
  "stage_key": "extract_text",
  "worker_id": "worker-abc123",
  "attempt": 1
}

{
  "timestamp": "2025-11-01T10:25:12.456Z",
  "level": "INFO",
  "event": "job_completed",
  "job_id": 12345,
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "doc_id": "660e8400-e29b-41d4-a716-446655440001",
  "stage_key": "extract_text",
  "duration_ms": 87234,
  "page_count": 5
}
16 | Performance Targets & Scaling
16.1 Baseline Targets (100-500 docs)
Metric	Target
Throughput	100-500 docs/hour
OCR latency (per page)	≤ 30 seconds
Classify latency	≤ 15 seconds
Annotate latency (per field)	≤ 10 seconds
Job lease latency	≤ 100ms
Watchdog recovery time	≤ 2 minutes
DLQ rate	≤ 1% of jobs
16.2 Scaling Configuration
ECS Service Configuration:

yaml
API Service:
  Desired Count: 2
  CPU: 512
  Memory: 1024 MB
  Auto Scaling: No (stable load)

Worker Service:
  Desired Count: 4-8 (scale based on queue depth)
  CPU: 1024
  Memory: 2048 MB
  Auto Scaling: Yes
  Scale Up: Queue depth > 50 jobs
  Scale Down: Queue depth < 10 jobs

Scheduler Service:
  Desired Count: 1 (singleton)
  CPU: 256
  Memory: 512 MB
  Auto Scaling: No
```

**Database Capacity:**
```
RDS Instance: db.t3.medium (2 vCPU, 4 GB RAM)
Connection Limit: 100
Connection Pool:
  - API (2 instances × 5 connections) = 10
  - Workers (8 instances × 2 connections) = 16
  - Scheduler (1 instance × 2 connections) = 2
  Total: ~30 connections (70% headroom)
17 | Migration & Rollout Plan
17.1 Phase 1: Shadow Mode (Week 1-2)
Deploy new system with USE_NEW_PIPELINE=false
Monitor logs and metrics
Verify database migrations successful
Test with 10% of traffic (feature flag)
17.2 Phase 2: Parallel Run (Week 3)
Enable USE_NEW_PIPELINE=true for 50% of uploads
Compare outputs with legacy system
Monitor error rates and latencies
17.3 Phase 3: Full Migration (Week 4)
Enable for 100% of uploads
Decommission legacy synchronous path
Monitor for 1 week before declaring complete
17.4 Rollback Plan
python
# Instant rollback via feature flag
if USE_NEW_PIPELINE and detect_high_error_rate():
    USE_NEW_PIPELINE = False  # Revert to legacy
    alert_team("Pipeline rolled back due to high error rate")
18 | Acceptance Criteria
✅ Functional Requirements
 Documents upload asynchronously via /pipeline/run endpoint
 Pipeline stages execute in order: upload → OCR → classify → annotate
 OCR JSON saved to S3 with key stored in documents.ocr_json_s3_key
 Annotations JSON saved to S3 with key stored in documents.annotations_json_s3_key
 Document type classification stored in documents.doc_type
 UI review functions unchanged (reads from existing DB columns)
 Bulk upload processes 100 documents in single API call
 Feature flag USE_NEW_PIPELINE controls rollout
✅ Reliability Requirements
 Failed jobs retry up to 3 times with exponential backoff
 Permanent errors (bad PDF) move to DLQ without retries
 Watchdog detects and resets stale jobs within 2 minutes
 Workers survive crashes (jobs auto-recovered by watchdog)
 Idempotency prevents duplicate processing of same inputs
 No duplicate job leases (concurrent workers safe)
✅ Performance Requirements
 Process 100 docs/hour with 4 workers
 Job lease query executes in < 100ms
 Database connection pool handles 8 concurrent workers
 Archive cleanup prevents table bloat
✅ Observability Requirements
 Structured JSON logs for all job events
 Logs include run_id, doc_id, stage_key for tracing
 /health endpoint reports DB status and active workers
 API returns run status with job counts by stage
 DLQ endpoint lists failed jobs with error details
19 | Implementation Checklist
Database
 Create all tables with schema in §4
 Add all critical indexes from §4.1
 Create Alembic migration scripts
 Test job lease query with 100 concurrent workers
Orchestrator
 Implement PipelineManager (§6.1)
 Implement JobQueue with lease/heartbeat/complete/fail (§6.2)
 Implement RetryPolicy with error categorization (§6.3)
 Implement DAGExecutor for linear pipelines (§6.4)
 Implement IdempotencyCache (§6.5)
 Implement StageRegistry factory pattern
Stages
 Implement BaseStage abstract class (§5.1)
 Implement UploadStage (§5.2.A)
 Implement ExtractTextStage with EasyOCR (§5.2.B)
 Implement ClassifyDocStage with Azure LLM (§5.2.C)
 Implement AutoAnnotateStage with Azure LLM (§5.2.D)
Adapters
 Implement S3Adapter with async boto3 (§10.1)
 Implement AzureLLMAdapter with retry logic (§10.2)
 Implement EasyOCRAdapter (§10.3)
 Implement mock adapters for testing
Workers & Scheduler
 Implement Worker main loop with semaphore concurrency (§7)
 Implement heartbeat background task
 Implement Watchdog with stale job reset (§8)
 Implement idempotency cache cleanup
 Implement job archival
API
 Add /pipeline/run endpoint (§9)
 Add /pipeline/bulk-upload endpoint (§9)
 Add /pipeline/runs/{id}/status endpoint (§9)
 Add /pipeline/runs/{id}/jobs endpoint (§9)
 Add /pipeline/dlq endpoint (§9)
 Add /health endpoint (§9)
 Add feature flag integration for rollout
Testing
 Unit tests for retry policy (§13.1)
 Unit tests for idempotency hash
 Integration test for concurrent lease (§13.2)
 Integration test for watchdog recovery
 E2E test for full pipeline (§13.3)
 Load test with 200 docs/hour
Deployment
 Create Dockerfile (§14.1)
 Create docker-compose.yml for local dev (§14.2)
 Create ECS task definitions for api/worker/scheduler (§14.3)
 Set up CloudWatch log groups
 Configure secrets in AWS Secrets Manager
Observability
 Implement structured logging (§15.1)
 Add log events for job lifecycle
 Configure CloudWatch Insights queries
 Set up alarms for DLQ rate > 5%
20 | Reference: Pipeline Config Examples
Example 1: Basic Linear Pipeline
json
{
  "name": "Basic_DocAI",
  "version": "1.0.0",
  "type": "linear",
  "entry_stage": "upload",
  "stages": {
    "upload": {
      "next": ["extract_text"],
      "timeout_seconds": 60,
      "max_retries": 3
    },
    "extract_text": {
      "next": ["classify_doc"],
      "timeout_seconds": 180,
      "max_retries": 3
    },
    "classify_doc": {
      "next": ["auto_annotate"],
      "timeout_seconds": 90,
      "max_retries": 3
    },
    "auto_annotate": {
      "next": [],
      "timeout_seconds": 300,
      "max_retries": 3
    }
  },
  "limits": {
    "max_concurrent_runs_per_project": 10
  },
  "policy": {
    "allowed_models": ["gpt-4o", "gpt-4o-mini"],
    "max_temperature": 0.2
  }
}
END OF SPECIFICATION

This document is production-ready for implementation by Claude Code or human developers. All critical fixes from the architect review have been incorporated, scaled appropriately for 100-500 documents, and unnecessary complexity has been removed.








