# PromptForge Pipeline - Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │ Web Browser  │  │  Mobile App  │  │   CLI Tool   │                 │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                 │
│         │                 │                 │                            │
│         └─────────────────┼─────────────────┘                            │
│                           │                                              │
│                   HTTP/REST API                                          │
└───────────────────────────┼──────────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────────┐
│                          API SERVER (FastAPI)                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              Backward Compatible Endpoints                       │   │
│  │  ┌────────────────┐         ┌─────────────────────────────┐     │   │
│  │  │  POST /api/    │         │  GET /api/pdf/:id           │     │   │
│  │  │    upload      │         │  GET /api/annotations/:id   │     │   │
│  │  │  (Legacy Sync) │         │  POST /api/search           │     │   │
│  │  └────────────────┘         └─────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              PromptForge Pipeline Endpoints                      │   │
│  │  ┌────────────────────────────────────────────────────────┐     │   │
│  │  │  POST /api/v1/pipeline/run                             │     │   │
│  │  │  POST /api/v1/pipeline/bulk-upload                     │     │   │
│  │  │  GET  /api/v1/pipeline/runs/:id/status                 │     │   │
│  │  │  GET  /api/v1/pipeline/runs/:id/jobs                   │     │   │
│  │  │  GET  /api/v1/pipeline/dlq                             │     │   │
│  │  │  GET  /api/v1/pipeline/health                          │     │   │
│  │  └────────────────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Orchestrator Layer                            │   │
│  │  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐           │   │
│  │  │  Pipeline    │  │ Job Queue   │  │ DAG Executor │           │   │
│  │  │  Manager     │  │             │  │              │           │   │
│  │  └──────────────┘  └─────────────┘  └──────────────┘           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
┌─────────▼──────────┐ ┌───────▼────────┐ ┌────────▼──────────┐
│   WORKER POOL      │ │   WORKER POOL  │ │   SCHEDULER       │
│   (Scalable)       │ │   (Scalable)   │ │   (Singleton)     │
│ ┌────────────────┐ │ │ ┌────────────┐ │ │ ┌───────────────┐ │
│ │ Worker 1       │ │ │ │ Worker 2   │ │ │ │   Watchdog    │ │
│ │ ┌────────────┐ │ │ │ │ ┌────────┐ │ │ │ │  - Reset Stale│ │
│ │ │ Lease Job  │ │ │ │ │ │ Lease  │ │ │ │ │  - Cleanup    │ │
│ │ │ Execute    │ │ │ │ │ │ Execute│ │ │ │ │  - Archive    │ │
│ │ │ Heartbeat  │ │ │ │ │ │ Heart- │ │ │ │ │  - DLQ Mgmt   │ │
│ │ └────────────┘ │ │ │ │ │ beat   │ │ │ │ └───────────────┘ │
│ └────────────────┘ │ │ │ └────────┘ │ │ └───────────────────┘
│                    │ │ └────────────┘ │
│ Concurrency: 2     │ │ Concurrency: 2 │   Interval: 60s
└────────────────────┘ └────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │    PostgreSQL       │
                    │   (Job Queue DB)    │
                    │                     │
                    │  ┌───────────────┐  │
                    │  │ pf_runs       │  │
                    │  │ pf_jobs       │  │
                    │  │ pf_jobs_dlq   │  │
                    │  │ pf_idem       │  │
                    │  │ pf_configs    │  │
                    │  │ pf_archive    │  │
                    │  └───────────────┘  │
                    └─────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
┌─────────▼──────────┐ ┌───────▼────────┐ ┌────────▼──────────┐
│   ADAPTER LAYER    │ │  ADAPTER LAYER │ │  ADAPTER LAYER    │
│   (Storage)        │ │   (OCR)        │ │   (LLM)           │
│ ┌────────────────┐ │ │ ┌────────────┐ │ │ ┌───────────────┐ │
│ │ Interface      │ │ │ │ Interface  │ │ │ │ Interface     │ │
│ │ StorageAdapter │ │ │ │ OCRAdapter │ │ │ │ LLMAdapter    │ │
│ └───────┬────────┘ │ │ └─────┬──────┘ │ │ └───────┬───────┘ │
│         │          │ │       │        │ │         │         │
│    ┌────┴────┐     │ │  ┌────┴────┐  │ │    ┌────┴────┐    │
│    │ ┌─────┐ │     │ │  │ ┌─────┐ │  │ │    │ ┌─────┐ │    │
│    │ │ FS  │ │     │ │  │ │Tess-│ │  │ │    │ │Azure│ │    │
│    │ │     │ │     │ │  │ │eract│ │  │ │    │ │ AI  │ │    │
│    │ └─────┘ │     │ │  │ └─────┘ │  │ │    │ └─────┘ │    │
│    │         │     │ │  │         │  │ │    │         │    │
│    │ ┌─────┐ │     │ │  │ ┌─────┐ │  │ │    │ ┌─────┐ │    │
│    │ │ S3  │ │     │ │  │ │Easy-│ │  │ │    │ │Mock │ │    │
│    │ │     │ │     │ │  │ │ OCR │ │  │ │    │ │     │ │    │
│    │ └─────┘ │     │ │  │ └─────┘ │  │ │    │ └─────┘ │    │
│    │         │     │ │  │         │  │ │    │         │    │
│    │ ┌─────┐ │     │ │  │ ┌─────┐ │  │ │    │ ┌─────┐ │    │
│    │ │Custom│     │ │  │ │Custom│ │  │ │    │ │Custom│   │
│    │ │     │ │     │ │  │ │     │ │  │ │    │ │     │ │    │
│    │ └─────┘ │     │ │  │ └─────┘ │  │ │    │ └─────┘ │    │
│    └─────────┘     │ │  └─────────┘  │ │    └─────────┘    │
│                    │ │               │ │                   │
│  Selectable via    │ │ Selectable via│ │ Selectable via    │
│  config or runtime │ │ config/runtime│ │ config/runtime    │
└────────────────────┘ └───────────────┘ └───────────────────┘
```

## Pipeline Stage Flow

```
┌──────────────────────────────────────────────────────────────┐
│                     PIPELINE EXECUTION FLOW                   │
└──────────────────────────────────────────────────────────────┘

Entry Point: POST /api/v1/pipeline/run
     │
     ▼
┌─────────────────────┐
│   Create Run        │  ← PipelineManager.submit_pipeline_run()
│   - Generate run_id │
│   - Snapshot config │
│   - Create entry job│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                    STAGE 1: UPLOAD                          │
│  Input:  { file_path, project_id, doc_id }                 │
│  Action: Upload to storage (filesystem or S3)              │
│  Output: { storage_key, file_size_bytes }                  │
│  Timeout: 60s  |  Max Retries: 3                           │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                 STAGE 2: EXTRACT_TEXT                       │
│  Input:  { storage_key, doc_id, ...prev_output }           │
│  Action: Download file, run OCR (Tesseract/EasyOCR)        │
│  Output: { ocr_json_storage_key, page_count }              │
│  Timeout: 300s  |  Max Retries: 3                          │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│               STAGE 3: CLASSIFY_DOC                         │
│  Input:  { ocr_json_storage_key, doc_id, ...prev }         │
│  Action: Load OCR, extract first page, call LLM            │
│  Output: { doc_type, fields[], confidence }                │
│  Timeout: 90s  |  Max Retries: 3                           │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│              STAGE 4: AUTO_ANNOTATE                         │
│  Input:  { ocr_json_storage_key, doc_type, fields, ... }   │
│  Action: Extract field values using LLM                    │
│  Output: { annotations_json_storage_key, field_count }     │
│  Timeout: 300s  |  Max Retries: 3                          │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
   ┌───────────────┐
   │ Run Complete  │
   │ status: done  │
   └───────────────┘
```

## Job Lifecycle State Machine

```
┌──────────────────────────────────────────────────────────────┐
│                    JOB STATE TRANSITIONS                      │
└──────────────────────────────────────────────────────────────┘

           ┌─────────┐
           │ QUEUED  │  ← Job created, not_before = NOW()
           └────┬────┘
                │
        Worker leases (SKIP LOCKED)
                │
                ▼
           ┌─────────┐
           │ RUNNING │  ← leased_by = worker_id, heartbeat starts
           └────┬────┘
                │
        ┌───────┴────────┐
        │                │
        ▼                ▼
   ┌─────────┐      ┌──────────┐
   │  DONE   │      │  FAILED  │
   └─────────┘      └────┬─────┘
                          │
                   ┌──────┴──────┐
                   │             │
            Should Retry?    Permanent?
                   │             │
                   ▼             ▼
             ┌─────────┐    ┌──────┐
             │ QUEUED  │    │ DLQ  │
             │ (retry) │    └──────┘
             └─────────┘
             not_before = NOW() + backoff
```

## Error Categorization Flow

```
Exception Occurred
      │
      ▼
┌──────────────────────────┐
│  RetryPolicy.categorize  │
└──────────┬───────────────┘
           │
    ┌──────┴──────┬──────────┬───────────┬──────────┐
    │             │          │           │          │
    ▼             ▼          ▼           ▼          ▼
┌─────────┐  ┌────────┐  ┌──────┐  ┌────────┐  ┌────────┐
│TRANSIENT│  │THROTTLE│  │CONFIG│  │PERMANENT│ │UNKNOWN │
└────┬────┘  └───┬────┘  └───┬──┘  └────┬───┘  └───┬────┘
     │           │            │          │          │
     ▼           ▼            ▼          ▼          ▼
  Retry     Retry with  No Retry  Move to DLQ  Treat as
  Short     Long       Alert Ops                Transient
  Backoff   Backoff

  2^n sec   2^n * 2    -         -            2^n sec
```

## Adapter Factory Pattern

```
┌──────────────────────────────────────────────────────────────┐
│                   AdapterFactory.get_*_adapter()              │
└──────────────────────────────────────────────────────────────┘
                              │
                   ┌──────────┴──────────┐
                   │                     │
            Custom Provided?      Check Config
                   │                     │
                   ▼                     ▼
            Return Custom      ┌─────────────────┐
                               │ settings.*_     │
                               │    PROVIDER     │
                               └────────┬────────┘
                                        │
                          ┌─────────────┼─────────────┐
                          │             │             │
                    "tesseract"     "azure"      "filesystem"
                          │             │             │
                          ▼             ▼             ▼
                  TesseractOCR   AzureOpenAI  FilesystemStorage
                     Adapter        Adapter      Adapter
```

## Database Query Performance

```
┌──────────────────────────────────────────────────────────────┐
│              CRITICAL DATABASE OPERATIONS                     │
└──────────────────────────────────────────────────────────────┘

1. Worker Lease Next Job (Hot Path)
   ┌──────────────────────────────────────────────┐
   │ SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1   │  ← Index: idx_jobs_queue
   │ WHERE status = 'queued'                      │     (not_before, id)
   │   AND not_before <= NOW()                    │
   │ ORDER BY not_before, id                      │  Performance: <10ms
   └──────────────────────────────────────────────┘

2. Watchdog Find Stale Jobs
   ┌──────────────────────────────────────────────┐
   │ UPDATE pf_jobs SET status = 'queued' ...    │  ← Index: idx_jobs_heartbeat
   │ WHERE status = 'running'                     │     (status, heartbeat_at)
   │   AND heartbeat_at < NOW() - INTERVAL '90s' │
   └──────────────────────────────────────────────┘  Performance: <100ms

3. Check Run Progress
   ┌──────────────────────────────────────────────┐
   │ SELECT COUNT(*) FROM pf_jobs                 │  ← Index: idx_jobs_run_id
   │ WHERE run_id = $1 AND status = 'done'        │     (run_id, status)
   └──────────────────────────────────────────────┘  Performance: <5ms
```

## Scaling Characteristics

```
┌──────────────────────────────────────────────────────────────┐
│                     SCALING DIMENSIONS                        │
└──────────────────────────────────────────────────────────────┘

Horizontal Scaling (Add Workers)
┌────┬────┬────┬────┬────┐
│ W1 │ W2 │ W3 │ W4 │ W5 │  ← Each worker: 2 concurrent jobs
└────┴────┴────┴────┴────┘
  Total Throughput: ~100 docs/hour (OCR-heavy)

Vertical Scaling (Increase Concurrency)
┌─────────────┐
│   Worker    │
│ ┌─┬─┬─┬─┬─┐ │  ← WORKER_MAX_CONCURRENT_JOBS = 5
│ │1│2│3│4│5│ │
│ └─┴─┴─┴─┴─┘ │  Higher memory usage, same machine
└─────────────┘

Database Scaling
┌──────────────┐
│  PostgreSQL  │  Connection Pool Size: 10
│ ┌──────────┐ │  Max Overflow: 5
│ │ Primary  │ │  Total: 15 connections
│ └──────────┘ │
└──────────────┘
  Can handle 10-20 workers comfortably
```

---

## Legend

- `┌─┐` : Component boundary
- `│ ▼ ` : Data/control flow
- `→ ←` : Bidirectional communication
- `...` : Continuation/truncation
- `[X]` : Completed/active state

---

**Note**: This architecture supports both synchronous (legacy `/api/upload`) and asynchronous (pipeline) processing paths, ensuring backward compatibility while enabling modern scalable workflows.
