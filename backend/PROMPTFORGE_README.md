# PromptForge Pipeline - Quick Start Guide

## Overview

PromptForge is a DAG-driven orchestration layer for asynchronous document processing with:
- ✅ Postgres-based job queue (no SQS/Redis)
- ✅ Retry logic with exponential backoff
- ✅ Watchdog recovery and Dead Letter Queue
- ✅ Plug-and-play adapter architecture
- ✅ Horizontal scaling via multiple workers

## Architecture

```
┌─────────────────────────────────────────┐
│         Single Docker Image             │
├─────────────────────────────────────────┤
│  Process 1: API Server (FastAPI)        │
│  Process 2: Worker (async executor)     │
│  Process 3: Scheduler (watchdog/DLQ)    │
└─────────────────────────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
# Install base requirements
pip install -r requirements.txt

# Install pipeline requirements
pip install -r requirements_pipeline.txt
```

### 2. Configure Database

Create a `.env` file:

```bash
# Database
DATABASE_URL=postgresql+asyncpg://user:password@localhost/promptforge

# Storage (filesystem or s3)
STORAGE_BACKEND=filesystem
STORAGE_BASE_PATH=./data/storage

# OCR Provider
OCR_PROVIDER=tesseract

# LLM Provider
LLM_PROVIDER=mock  # Change to 'azure' when ready

# Optional: Azure OpenAI (if using)
# AZURE_OPENAI_API_KEY=your-key
# AZURE_OPENAI_ENDPOINT=https://your-endpoint.openai.azure.com/
# AZURE_OPENAI_DEPLOYMENT=gpt-4o

# Worker Settings
WORKER_MAX_CONCURRENT_JOBS=2
WORKER_HEARTBEAT_INTERVAL=30

# Feature Flags
USE_NEW_PIPELINE=true
ENABLE_IDEMPOTENCY_CACHE=true
```

### 3. Initialize Database

```bash
python -m promptforge.cli setup
```

This will:
- Create all pipeline tables
- Load the default pipeline configuration

### 4. Start Services

#### Option A: Run All Processes Separately

```bash
# Terminal 1: API Server
python main_with_pipeline.py

# Terminal 2: Worker
python -m promptforge.workers.loop

# Terminal 3: Scheduler (Watchdog)
python -m promptforge.scheduler.watchdog
```

#### Option B: Using Docker Compose (see below)

## API Usage

### Single Document Upload

```bash
curl -X POST "http://localhost:8000/api/v1/pipeline/run" \
  -F "file=@document.pdf" \
  -F "project_id=123e4567-e89b-12d3-a456-426614174000" \
  -F "pipeline_version=1.0.0"
```

Response:
```json
{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "doc_id": "660e8400-e29b-41d4-a716-446655440001",
  "status": "queued",
  "message": "Pipeline started successfully"
}
```

### Check Pipeline Status

```bash
curl "http://localhost:8000/api/v1/pipeline/runs/{run_id}/status"
```

Response:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "run_status": "running",
  "total_jobs": 4,
  "completed": 2,
  "failed": 0,
  "running": 1,
  "queued": 1
}
```

### Bulk Upload

```bash
curl -X POST "http://localhost:8000/api/v1/pipeline/bulk-upload" \
  -F "files=@doc1.pdf" \
  -F "files=@doc2.pdf" \
  -F "files=@doc3.pdf" \
  -F "project_id=123e4567-e89b-12d3-a456-426614174000"
```

### Check Health

```bash
curl "http://localhost:8000/api/v1/pipeline/health"
```

## Pipeline Stages

The default pipeline includes 4 stages:

1. **Upload** (`upload`)
   - Uploads document to storage (filesystem or S3)
   - Timeout: 60s, Max retries: 3

2. **Extract Text** (`extract_text`)
   - Runs OCR to extract text and bounding boxes
   - Timeout: 300s, Max retries: 3

3. **Classify Document** (`classify_doc`)
   - Determines document type using LLM
   - Timeout: 90s, Max retries: 3

4. **Auto-Annotate** (`auto_annotate`)
   - Extracts field values from document
   - Timeout: 300s, Max retries: 3

## Plug-and-Play Adapters

### Custom Storage Adapter

```python
from promptforge.adapters.base import StorageAdapter
from promptforge.adapters.factory import AdapterFactory

class MyCustomStorageAdapter(StorageAdapter):
    async def upload_file(self, local_path, storage_key):
        # Your implementation
        pass

    # ... implement other methods

# Use it
AdapterFactory.get_storage_adapter(custom_adapter=MyCustomStorageAdapter())
```

### Custom OCR Provider

```python
from promptforge.adapters.base import OCRAdapter

class MyOCRAdapter(OCRAdapter):
    async def extract_text(self, file_path):
        # Your OCR implementation
        return {
            "pages": [
                {
                    "page": 1,
                    "lines": [
                        {
                            "bbox": [x0, y0, x1, y1],
                            "text": "extracted text",
                            "confidence": 0.95
                        }
                    ]
                }
            ]
        }

    def get_provider_name(self):
        return "my_ocr"

# Register it
AdapterFactory.get_ocr_adapter(custom_adapter=MyOCRAdapter())
```

### Custom LLM Provider

```python
from promptforge.adapters.base import LLMAdapter

class MyLLMAdapter(LLMAdapter):
    async def complete(self, prompt, model, temperature, max_tokens, response_format):
        # Your LLM implementation
        return {
            "content": "response text",
            "tokens_used": 150,
            "cost_usd": 0.0045
        }

    def get_provider_name(self):
        return "my_llm"

AdapterFactory.get_llm_adapter(custom_adapter=MyLLMAdapter())
```

## Custom Pipeline Configuration

Create a custom pipeline JSON:

```json
{
  "name": "Custom_Pipeline",
  "version": "2.0.0",
  "type": "linear",
  "entry_stage": "upload",
  "stages": {
    "upload": {
      "next": ["extract_text"],
      "timeout_seconds": 60,
      "max_retries": 3
    },
    "extract_text": {
      "next": ["my_custom_stage"],
      "timeout_seconds": 300,
      "max_retries": 3
    },
    "my_custom_stage": {
      "next": [],
      "timeout_seconds": 120,
      "max_retries": 2
    }
  }
}
```

Load it:

```python
from promptforge.orchestrator import PipelineManager
from promptforge.models import PipelineDefinition
import json

# Load from file
with open("my_pipeline.json") as f:
    config_data = json.load(f)

pipeline_def = PipelineDefinition.from_dict(config_data)

# Save to database
manager = PipelineManager(db)
await manager.save_pipeline_config(
    config=pipeline_def,
    project_id=None,  # Global or specific project UUID
    set_active=True
)
```

## Monitoring & Debugging

### View Job Details

```bash
curl "http://localhost:8000/api/v1/pipeline/runs/{run_id}/jobs"
```

### Check Dead Letter Queue

```bash
curl "http://localhost:8000/api/v1/pipeline/dlq"
```

### Database Queries

```sql
-- Check job status distribution
SELECT status, COUNT(*) FROM pf_jobs GROUP BY status;

-- Find failed jobs
SELECT id, stage_key, error_msg FROM pf_jobs WHERE status = 'failed';

-- Check active workers
SELECT DISTINCT leased_by, COUNT(*) as active_jobs
FROM pf_jobs
WHERE status = 'running' AND heartbeat_at > NOW() - INTERVAL '2 minutes'
GROUP BY leased_by;

-- View pipeline runs
SELECT id, status, completed_jobs, failed_jobs, total_jobs
FROM pf_runs
ORDER BY created_at DESC
LIMIT 10;
```

## Performance Tuning

### Worker Concurrency

Adjust `WORKER_MAX_CONCURRENT_JOBS` to control how many jobs each worker processes simultaneously.

### Scaling Workers

Run multiple worker instances:

```bash
# Worker 1
WORKER_ID=worker-1 python -m promptforge.workers.loop

# Worker 2
WORKER_ID=worker-2 python -m promptforge.workers.loop

# Worker 3
WORKER_ID=worker-3 python -m promptforge.workers.loop
```

### Database Connection Pool

Adjust in `.env`:

```bash
DB_POOL_SIZE=10
DB_MAX_OVERFLOW=5
```

## Troubleshooting

### Jobs stuck in 'running' state

The watchdog will automatically reset stale jobs after 90 seconds (configurable via `WATCHDOG_STALE_THRESHOLD`).

### High memory usage

- Reduce `WORKER_MAX_CONCURRENT_JOBS`
- Increase number of worker instances
- Check for memory leaks in custom adapters

### Slow OCR processing

- Use GPU-accelerated OCR (EasyOCR with CUDA)
- Reduce image DPI in OCR preprocessing
- Process pages in parallel (custom stage implementation)

## Next Steps

1. **Replace Mock LLM**: Implement actual Azure OpenAI or OpenAI adapter
2. **Add Custom Stages**: Create stages for your specific use case
3. **Configure S3**: Switch from filesystem to S3 storage for production
4. **Set up Monitoring**: Add Prometheus metrics and alerting
5. **Deploy to ECS**: Use the provided task definitions for AWS deployment

## Support

For questions or issues, refer to:
- API Documentation: http://localhost:8000/docs (when server is running)
- Pipeline Specification: `pipeline_module.md`
- Integration Guide: `INTEGRATION_GUIDE.md`
