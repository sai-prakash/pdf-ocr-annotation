# PromptForge Pipeline - Testing Guide

## 🧪 Complete Testing Setup & Instructions

This guide walks you through setting up the database and testing the pipeline from scratch.

---

## Step 1: Install PostgreSQL

### macOS (Homebrew)

```bash
# Install PostgreSQL
brew install postgresql@14

# Start PostgreSQL service
brew services start postgresql@14

# Verify installation
psql --version
# Should show: psql (PostgreSQL) 14.x
```

### Ubuntu/Debian

```bash
# Install PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib

# Start service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify
psql --version
```

### Windows

1. Download installer from: https://www.postgresql.org/download/windows/
2. Run installer (use default port 5432)
3. Remember the password you set for `postgres` user

### Docker (Quick Start)

```bash
# Run PostgreSQL in Docker
docker run -d \
  --name promptforge-postgres \
  -e POSTGRES_DB=promptforge \
  -e POSTGRES_USER=promptforge \
  -e POSTGRES_PASSWORD=promptforge_dev \
  -p 5432:5432 \
  postgres:14-alpine

# Verify it's running
docker ps | grep promptforge-postgres
```

---

## Step 2: Create Database

### Option A: Using psql (Command Line)

```bash
# Connect to PostgreSQL as default user
psql postgres

# Inside psql prompt:
CREATE DATABASE promptforge;
CREATE USER promptforge WITH PASSWORD 'promptforge_dev';
GRANT ALL PRIVILEGES ON DATABASE promptforge TO promptforge;

# Exit psql
\q
```

### Option B: Using createdb command

```bash
# macOS/Linux
createdb promptforge

# If you need to create a user:
createuser -P promptforge  # Will prompt for password
```

### Option C: Using Docker

```bash
# Already created if you used the Docker command above
# Or connect to running container:
docker exec -it promptforge-postgres psql -U promptforge -d promptforge
```

---

## Step 3: Verify Database Connection

```bash
# Test connection
psql -U promptforge -d promptforge -h localhost

# You should see:
# promptforge=#

# Check current database
\conninfo

# List databases
\l

# Exit
\q
```

---

## Step 4: Configure Environment

Create `.env` file in `backend/` directory:

```bash
cd backend
cp .env.example .env
```

Edit `.env`:

```bash
# Database Configuration
DATABASE_URL=postgresql+asyncpg://promptforge:promptforge_dev@localhost:5432/promptforge

# Storage (use filesystem for testing)
STORAGE_BACKEND=filesystem
STORAGE_BASE_PATH=./data/storage

# OCR Provider
OCR_PROVIDER=tesseract

# LLM Provider (use mock for testing)
LLM_PROVIDER=mock

# Worker Settings
WORKER_ID=worker-test-1
WORKER_MAX_CONCURRENT_JOBS=2
WORKER_HEARTBEAT_INTERVAL=30

# Watchdog Settings
WATCHDOG_INTERVAL=60
WATCHDOG_STALE_THRESHOLD=90

# Feature Flags
USE_NEW_PIPELINE=true
ENABLE_IDEMPOTENCY_CACHE=true

# Logging
LOG_LEVEL=INFO
```

---

## Step 5: Install Python Dependencies

```bash
cd backend

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
pip install -r requirements_pipeline.txt

# Verify asyncpg is installed
pip list | grep asyncpg
# Should show: asyncpg  0.29.0
```

---

## Step 6: Initialize Database Schema

### Option A: Using Setup Script (Recommended)

```bash
cd backend
chmod +x setup_pipeline.sh
./setup_pipeline.sh
```

You should see:
```
=========================================
PromptForge Pipeline Setup
=========================================
✓ Python 3 found
Installing dependencies...
✓ Dependencies installed
Checking database connection...
Database URL: postgresql+asyncpg://promptforge:promptforge_dev@localhost:5432/promptforge
Initializing database schema...
✓ Database schema initialized
Loading default pipeline configuration...
✓ Default pipeline loaded
=========================================
Setup Complete!
=========================================
```

### Option B: Manual Setup

```bash
# Initialize schema
python -m promptforge.cli init-db

# Load default pipeline
python -m promptforge.cli load-pipeline

# Or do both at once
python -m promptforge.cli setup
```

---

## Step 7: Verify Database Tables

```bash
# Connect to database
psql -U promptforge -d promptforge -h localhost

# List all tables
\dt

# You should see:
#  pf_idem
#  pf_jobs
#  pf_jobs_archive
#  pf_jobs_dlq
#  pf_pipeline_configs
#  pf_runs

# Check pipeline config was loaded
SELECT id, version, is_active FROM pf_pipeline_configs;

# You should see:
#  id | version | is_active
# ----+---------+-----------
#   1 | 1.0.0   | t

# Exit
\q
```

---

## Step 8: Start the Pipeline Services

### Terminal 1: API Server

```bash
cd backend
source venv/bin/activate  # If using virtual env
python main_with_pipeline.py
```

You should see:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Terminal 2: Worker

```bash
cd backend
source venv/bin/activate
python -m promptforge.workers.loop
```

You should see:
```
2025-11-02 15:30:00 - promptforge.workers.loop - INFO - Worker worker-test-1 initialized (max_concurrent=2)
2025-11-02 15:30:00 - promptforge.workers.loop - INFO - Worker worker-test-1 started
```

### Terminal 3: Scheduler (Watchdog)

```bash
cd backend
source venv/bin/activate
python -m promptforge.scheduler.watchdog
```

You should see:
```
2025-11-02 15:30:05 - promptforge.scheduler.watchdog - INFO - Watchdog initialized
2025-11-02 15:30:05 - promptforge.scheduler.watchdog - INFO - Watchdog started
```

---

## Step 9: Test the Pipeline

### Test 1: Health Check

```bash
curl http://localhost:8000/api/v1/pipeline/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "active_workers": 1,
  "timestamp": "2025-11-02T15:30:10.123456"
}
```

### Test 2: Upload a Test Document

Create a test PDF (or use an existing one):

```bash
# Upload via curl
curl -X POST "http://localhost:8000/api/v1/pipeline/run" \
  -F "file=@test.pdf" \
  -F "pipeline_version=1.0.0"
```

Expected response:
```json
{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "doc_id": "660e8400-e29b-41d4-a716-446655440001",
  "status": "queued",
  "message": "Pipeline started successfully"
}
```

### Test 3: Check Run Status

```bash
# Replace {run_id} with the ID from previous response
curl http://localhost:8000/api/v1/pipeline/runs/{run_id}/status
```

Expected response (initially):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": null,
  "run_status": "running",
  "started_at": "2025-11-02T15:30:15",
  "finished_at": null,
  "total_jobs": 4,
  "current_jobs": 4,
  "completed": 1,
  "failed": 0,
  "running": 1,
  "queued": 2
}
```

Wait a minute and check again - status should eventually be "done":
```json
{
  "run_status": "done",
  "completed": 4,
  "failed": 0,
  "running": 0,
  "queued": 0
}
```

### Test 4: View Job Details

```bash
curl "http://localhost:8000/api/v1/pipeline/runs/{run_id}/jobs"
```

Expected response:
```json
{
  "jobs": [
    {
      "id": 1,
      "doc_id": "660e8400-...",
      "stage_key": "upload",
      "status": "done",
      "attempts": 1,
      "error_msg": null,
      "created_at": "2025-11-02T15:30:15",
      "updated_at": "2025-11-02T15:30:16"
    },
    {
      "id": 2,
      "doc_id": "660e8400-...",
      "stage_key": "extract_text",
      "status": "done",
      "attempts": 1,
      "error_msg": null,
      "created_at": "2025-11-02T15:30:16",
      "updated_at": "2025-11-02T15:32:45"
    },
    // ... more jobs
  ]
}
```

### Test 5: Bulk Upload

```bash
curl -X POST "http://localhost:8000/api/v1/pipeline/bulk-upload" \
  -F "files=@doc1.pdf" \
  -F "files=@doc2.pdf" \
  -F "files=@doc3.pdf"
```

---

## Step 10: Verify in Database

```bash
# Connect to database
psql -U promptforge -d promptforge -h localhost
```

### Check pipeline runs
```sql
SELECT id, status, total_jobs, completed_jobs, failed_jobs
FROM pf_runs
ORDER BY created_at DESC
LIMIT 5;
```

### Check job queue
```sql
SELECT id, stage_key, status, attempts, error_msg
FROM pf_jobs
ORDER BY created_at DESC
LIMIT 10;
```

### Check active workers
```sql
SELECT DISTINCT leased_by, COUNT(*) as active_jobs
FROM pf_jobs
WHERE status = 'running'
  AND heartbeat_at > NOW() - INTERVAL '2 minutes'
GROUP BY leased_by;
```

### Check DLQ (should be empty initially)
```sql
SELECT * FROM pf_jobs_dlq;
```

### Check idempotency cache
```sql
SELECT COUNT(*) as cache_entries
FROM pf_idem;
```

---

## 🧪 Advanced Testing

### Test Retry Logic

Force a job to fail and retry:

```python
# Temporarily modify a stage to fail
# In promptforge/stages/classify_stage.py

async def execute(self, input_data):
    # Force failure for testing
    raise Exception("Test failure - transient error")
```

Restart worker and upload a document. You should see:
- Job fails with `status='queued'` and `attempts=1`
- After backoff period, worker retries
- Job eventually moves to DLQ after max retries

### Test Idempotency

```bash
# Upload same document twice with same inputs
curl -X POST "http://localhost:8000/api/v1/pipeline/run" \
  -F "file=@test.pdf"

# Second upload should use cached results (check logs)
```

### Test Watchdog

1. Stop the worker (Ctrl+C in Terminal 2)
2. Start a new job
3. Wait 90 seconds
4. Check logs - watchdog should reset the stale job

```sql
-- In database, you can manually check:
SELECT id, status, leased_by, heartbeat_at
FROM pf_jobs
WHERE status = 'running';
```

### Load Testing

```bash
# Install hey (HTTP load testing tool)
brew install hey  # macOS
# or: go install github.com/rakyll/hey@latest

# Run load test (10 requests, 2 concurrent)
hey -n 10 -c 2 -m POST \
  -F "file=@test.pdf" \
  http://localhost:8000/api/v1/pipeline/run
```

---

## 🐛 Troubleshooting

### Issue: "Database connection failed"

**Check PostgreSQL is running:**
```bash
# macOS
brew services list | grep postgresql

# Linux
sudo systemctl status postgresql

# Docker
docker ps | grep postgres
```

**Verify connection string:**
```bash
# Test with psql
psql "postgresql://promptforge:promptforge_dev@localhost:5432/promptforge"
```

### Issue: "No module named 'asyncpg'"

```bash
pip install asyncpg
# or
pip install -r requirements_pipeline.txt
```

### Issue: "Tesseract not found"

```bash
# macOS
brew install tesseract

# Ubuntu
sudo apt install tesseract-ocr

# Verify
tesseract --version
```

### Issue: "Worker not picking up jobs"

**Check worker logs** - should show:
```
INFO - Worker worker-test-1 started
```

**Check database** - jobs should be in 'queued' status:
```sql
SELECT COUNT(*) FROM pf_jobs WHERE status = 'queued';
```

**Check `.env`** - ensure `DATABASE_URL` is correct

### Issue: "API returns 500 error"

**Check API logs** - look for error details

**Check database connection:**
```bash
# In Python
python -c "from promptforge.infra.db import db; import asyncio; asyncio.run(db.connect())"
```

### Issue: "Jobs stuck in 'running' state"

**Check heartbeat:**
```sql
SELECT id, leased_by, heartbeat_at, NOW() - heartbeat_at as stale_duration
FROM pf_jobs
WHERE status = 'running';
```

**Manually reset if needed:**
```sql
UPDATE pf_jobs
SET status = 'queued', leased_by = NULL, heartbeat_at = NULL
WHERE status = 'running';
```

---

## 📊 Monitoring Queries

### Queue Depth
```sql
SELECT COUNT(*) as queued_jobs FROM pf_jobs WHERE status = 'queued';
```

### Jobs by Stage
```sql
SELECT stage_key, status, COUNT(*)
FROM pf_jobs
GROUP BY stage_key, status
ORDER BY stage_key, status;
```

### Average Job Duration
```sql
SELECT
  stage_key,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_duration_seconds,
  MIN(EXTRACT(EPOCH FROM (updated_at - created_at))) as min_duration,
  MAX(EXTRACT(EPOCH FROM (updated_at - created_at))) as max_duration
FROM pf_jobs
WHERE status = 'done'
GROUP BY stage_key;
```

### Failure Rate
```sql
SELECT
  stage_key,
  COUNT(*) FILTER (WHERE status = 'done') as successful,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'failed') / COUNT(*),
    2
  ) as failure_rate_pct
FROM pf_jobs
GROUP BY stage_key;
```

### Active Runs
```sql
SELECT
  r.id,
  r.status,
  r.started_at,
  r.total_jobs,
  r.completed_jobs,
  r.failed_jobs,
  ROUND(100.0 * r.completed_jobs / NULLIF(r.total_jobs, 0), 2) as progress_pct
FROM pf_runs r
WHERE r.status = 'running'
ORDER BY r.started_at DESC;
```

---

## 🎯 Testing Checklist

- [ ] PostgreSQL installed and running
- [ ] Database `promptforge` created
- [ ] User `promptforge` created with password
- [ ] Python dependencies installed (asyncpg, pydantic-settings)
- [ ] `.env` file configured with correct DATABASE_URL
- [ ] Database schema initialized (`python -m promptforge.cli init-db`)
- [ ] Default pipeline loaded (`python -m promptforge.cli load-pipeline`)
- [ ] 6 tables created (verified with `\dt` in psql)
- [ ] API server starts without errors
- [ ] Worker starts and shows "initialized" message
- [ ] Scheduler starts and shows "started" message
- [ ] Health check returns `{"status": "healthy"}`
- [ ] Single document upload works
- [ ] Job progresses through all 4 stages
- [ ] Run status changes to "done"
- [ ] Database shows completed jobs
- [ ] Bulk upload works with multiple files
- [ ] Worker logs show job processing
- [ ] Idempotency cache prevents duplicates
- [ ] Watchdog resets stale jobs

---

## 🚀 Quick Start Script

Save this as `test_pipeline.sh`:

```bash
#!/bin/bash
set -e

echo "🧪 Testing PromptForge Pipeline"
echo "================================"

# 1. Health check
echo "1. Checking API health..."
curl -s http://localhost:8000/api/v1/pipeline/health | jq

# 2. Upload document
echo -e "\n2. Uploading test document..."
RUN_ID=$(curl -s -X POST "http://localhost:8000/api/v1/pipeline/run" \
  -F "file=@test.pdf" | jq -r '.run_id')

echo "Run ID: $RUN_ID"

# 3. Wait and check status
echo -e "\n3. Waiting for processing..."
sleep 5

curl -s "http://localhost:8000/api/v1/pipeline/runs/$RUN_ID/status" | jq

# 4. Check jobs
echo -e "\n4. Job details:"
curl -s "http://localhost:8000/api/v1/pipeline/runs/$RUN_ID/jobs" | jq

echo -e "\n✅ Test complete!"
```

Run it:
```bash
chmod +x test_pipeline.sh
./test_pipeline.sh
```

---

**Need help?** Check the logs in each terminal window and review the troubleshooting section above!
