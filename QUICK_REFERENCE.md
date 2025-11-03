# PromptForge Pipeline - Quick Reference

## 🚀 Quick Start Commands

### Initial Setup
```bash
# 1. Create database
createdb promptforge
createuser -P promptforge  # Password: promptforge_dev

# 2. Install dependencies
cd backend
pip install -r requirements.txt -r requirements_pipeline.txt

# 3. Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL

# 4. Initialize
./setup_pipeline.sh
```

### Start Services
```bash
# Terminal 1: API
python main_with_pipeline.py

# Terminal 2: Worker
python -m promptforge.workers.loop

# Terminal 3: Scheduler
python -m promptforge.scheduler.watchdog
```

### Docker (Alternative)
```bash
docker-compose up
```

---

## 📡 API Endpoints

### Upload Single Document
```bash
curl -X POST "http://localhost:8000/api/v1/pipeline/run" \
  -F "file=@document.pdf"
```

### Bulk Upload
```bash
curl -X POST "http://localhost:8000/api/v1/pipeline/bulk-upload" \
  -F "files=@doc1.pdf" \
  -F "files=@doc2.pdf" \
  -F "files=@doc3.pdf"
```

### Check Run Status
```bash
curl "http://localhost:8000/api/v1/pipeline/runs/{run_id}/status"
```

### Get Job Details
```bash
curl "http://localhost:8000/api/v1/pipeline/runs/{run_id}/jobs"
```

### View DLQ
```bash
curl "http://localhost:8000/api/v1/pipeline/dlq?limit=50"
```

### Health Check
```bash
curl "http://localhost:8000/api/v1/pipeline/health"
```

---

## 🗄️ Database Commands

### Connect to Database
```bash
psql -U promptforge -d promptforge -h localhost
```

### Useful Queries

**Queue depth:**
```sql
SELECT COUNT(*) FROM pf_jobs WHERE status = 'queued';
```

**Active runs:**
```sql
SELECT id, status, completed_jobs, total_jobs FROM pf_runs WHERE status = 'running';
```

**Failed jobs:**
```sql
SELECT id, stage_key, error_msg FROM pf_jobs WHERE status = 'failed';
```

**Active workers:**
```sql
SELECT DISTINCT leased_by, COUNT(*) FROM pf_jobs
WHERE status = 'running' AND heartbeat_at > NOW() - INTERVAL '2 minutes'
GROUP BY leased_by;
```

**Job statistics:**
```sql
SELECT stage_key, status, COUNT(*) FROM pf_jobs
GROUP BY stage_key, status ORDER BY stage_key;
```

**Reset stuck jobs:**
```sql
UPDATE pf_jobs SET status = 'queued', leased_by = NULL
WHERE status = 'running' AND heartbeat_at < NOW() - INTERVAL '5 minutes';
```

---

## 🔧 Management Commands

### Initialize Database
```bash
python -m promptforge.cli init-db
```

### Load Default Pipeline
```bash
python -m promptforge.cli load-pipeline
```

### Complete Setup
```bash
python -m promptforge.cli setup
```

---

## 🐳 Docker Commands

### Start all services
```bash
docker-compose up
```

### Start in background
```bash
docker-compose up -d
```

### View logs
```bash
docker-compose logs -f
docker-compose logs -f worker    # Specific service
```

### Scale workers
```bash
docker-compose up --scale worker=5
```

### Stop services
```bash
docker-compose down
```

### Reset everything
```bash
docker-compose down -v  # Removes volumes too
```

---

## 📊 Monitoring

### Check API logs
```bash
tail -f backend/pdf_processing.log
```

### Check worker logs (if running in background)
```bash
# Find process
ps aux | grep promptforge.workers

# Or in Docker
docker logs -f promptforge-worker-1
```

### Database monitoring
```bash
# Connection count
psql -U promptforge -d promptforge -c "SELECT count(*) FROM pg_stat_activity;"

# Active queries
psql -U promptforge -d promptforge -c "SELECT query, state FROM pg_stat_activity WHERE state = 'active';"
```

---

## 🔄 Common Tasks

### Add a new worker
```bash
WORKER_ID=worker-2 WORKER_MAX_CONCURRENT_JOBS=2 python -m promptforge.workers.loop
```

### Change log level
```bash
LOG_LEVEL=DEBUG python main_with_pipeline.py
```

### Clear old jobs (archive)
```sql
-- Move to archive
INSERT INTO pf_jobs_archive SELECT *, NOW() FROM pf_jobs
WHERE status IN ('done', 'failed') AND updated_at < NOW() - INTERVAL '30 days';

-- Delete from main table
DELETE FROM pf_jobs
WHERE status IN ('done', 'failed') AND updated_at < NOW() - INTERVAL '30 days';
```

### Retry failed jobs
```sql
-- Reset failed jobs to queued
UPDATE pf_jobs SET status = 'queued', attempts = 0, not_before = NOW()
WHERE status = 'failed' AND error_category = 'transient';
```

---

## 🔌 Configuration

### Environment Variables (.env)

```bash
# Database
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/promptforge

# Storage
STORAGE_BACKEND=filesystem  # or 's3'
STORAGE_BASE_PATH=./data/storage

# Providers
OCR_PROVIDER=tesseract      # or 'easyocr', 'custom'
LLM_PROVIDER=mock           # or 'azure', 'openai', 'custom'

# Worker
WORKER_MAX_CONCURRENT_JOBS=2
WORKER_HEARTBEAT_INTERVAL=30

# Features
USE_NEW_PIPELINE=true
ENABLE_IDEMPOTENCY_CACHE=true
```

### Pipeline Configuration (JSON)

```json
{
  "name": "My_Pipeline",
  "version": "1.0.0",
  "type": "linear",
  "entry_stage": "upload",
  "stages": {
    "stage_name": {
      "next": ["next_stage"],
      "timeout_seconds": 300,
      "max_retries": 3
    }
  }
}
```

---

## 🐛 Troubleshooting

### Database connection failed
```bash
# Test connection
psql "postgresql://promptforge:promptforge_dev@localhost:5432/promptforge"

# Check if PostgreSQL is running
brew services list | grep postgresql  # macOS
sudo systemctl status postgresql      # Linux
```

### Worker not processing jobs
```bash
# Check worker is running
ps aux | grep promptforge.workers

# Check database connection in worker logs
# Should see: "Worker worker-xxx initialized"

# Check queue has jobs
psql -U promptforge -d promptforge -c "SELECT COUNT(*) FROM pf_jobs WHERE status = 'queued';"
```

### Jobs stuck in running state
```bash
# Check heartbeat
psql -U promptforge -d promptforge -c "SELECT id, heartbeat_at, NOW() - heartbeat_at FROM pf_jobs WHERE status = 'running';"

# Wait for watchdog to reset (90 seconds)
# Or manually reset
psql -U promptforge -d promptforge -c "UPDATE pf_jobs SET status = 'queued', leased_by = NULL WHERE status = 'running';"
```

### API returns 500 error
```bash
# Check API logs
tail -f backend/pdf_processing.log

# Check database connection
python -c "from promptforge.infra.db import db; import asyncio; asyncio.run(db.connect())"
```

---

## 📈 Performance Tuning

### Scale workers horizontally
```bash
# Run multiple workers
for i in {1..5}; do
  WORKER_ID=worker-$i python -m promptforge.workers.loop &
done
```

### Increase worker concurrency
```bash
WORKER_MAX_CONCURRENT_JOBS=5 python -m promptforge.workers.loop
```

### Database connection pool
```bash
# In .env
DB_POOL_SIZE=20
DB_MAX_OVERFLOW=10
```

---

## 🔐 Security

### Change default password
```bash
# In psql
ALTER USER promptforge WITH PASSWORD 'new_secure_password';

# Update .env
DATABASE_URL=postgresql+asyncpg://promptforge:new_secure_password@localhost/promptforge
```

### Restrict API access (add to main_with_pipeline.py)
```python
from fastapi import Header, HTTPException

async def verify_token(authorization: str = Header(...)):
    if authorization != "Bearer your-secret-token":
        raise HTTPException(401, "Unauthorized")
    return True

@router.post("/run", dependencies=[Depends(verify_token)])
async def create_pipeline_run(...):
    # Protected endpoint
```

---

## 📝 Logging

### Enable debug logging
```bash
LOG_LEVEL=DEBUG python -m promptforge.workers.loop
```

### Structured logging
```bash
STRUCTURED_LOGGING=true python main_with_pipeline.py
```

### Log to file
```python
# Add to worker startup
import logging
logging.basicConfig(
    level=logging.INFO,
    handlers=[
        logging.FileHandler('worker.log'),
        logging.StreamHandler()
    ]
)
```

---

## 📚 Documentation Links

- **Full Setup**: `TESTING_GUIDE.md`
- **Quick Start**: `PROMPTFORGE_README.md`
- **Integration**: `PROMPTFORGE_INTEGRATION.md`
- **Architecture**: `ARCHITECTURE_DIAGRAM.md`
- **Specification**: `pipeline_module.md`

---

## 🆘 Getting Help

**Check logs first:**
```bash
# API
tail -f backend/pdf_processing.log

# Worker
# Look at terminal output

# Database
psql -U promptforge -d promptforge -c "SELECT * FROM pf_jobs ORDER BY updated_at DESC LIMIT 10;"
```

**Common issues:**
1. Database connection → Check PostgreSQL is running
2. Worker not processing → Check DATABASE_URL in .env
3. Jobs failing → Check error_msg in pf_jobs table
4. High memory usage → Reduce WORKER_MAX_CONCURRENT_JOBS

---

**Pro tip:** Keep this file open in a separate terminal for quick copy-paste! 📋
