# PromptForge Pipeline - Troubleshooting Guide

## 🔧 Common Errors & Solutions

### Error: `ModuleNotFoundError: No module named 'asyncpg'`

**Problem**: Required Python packages not installed

**Solution**:
```bash
cd backend
pip install -r requirements.txt
pip install -r requirements_pipeline.txt
```

**Why**: The pipeline requires additional packages beyond your base requirements:
- `asyncpg` - Async PostgreSQL driver
- `pydantic-settings` - Configuration management

---

### Error: `NameError: name 'Optional' is not defined`

**Problem**: Missing typing import (already fixed in the codebase)

**Solution**: This error has been fixed. If you still see it:
```bash
# Pull latest changes
git pull

# Or manually add to the affected file:
from typing import Optional
```

---

### Error: Database connection failed

**Full error**:
```
asyncpg.exceptions.InvalidCatalogNameError: database "promptforge" does not exist
```

**Solution**:
```bash
# Create the database
createdb promptforge

# Or using psql:
psql postgres -c "CREATE DATABASE promptforge;"
```

---

### Error: `relation "pf_jobs" does not exist`

**Problem**: Database schema not initialized

**Solution**:
```bash
cd backend
python -m promptforge.cli init-db
```

Or run the full setup:
```bash
./setup_pipeline.sh
```

---

### Error: `no active host` or connection refused

**Full error**:
```
could not connect to server: Connection refused
Is the server running on host "localhost" and accepting TCP/IP connections on port 5432?
```

**Problem**: PostgreSQL not running

**Solution**:

**macOS**:
```bash
brew services start postgresql@14
```

**Linux**:
```bash
sudo systemctl start postgresql
```

**Docker**:
```bash
docker run -d --name promptforge-postgres \
  -e POSTGRES_DB=promptforge \
  -e POSTGRES_USER=promptforge \
  -e POSTGRES_PASSWORD=promptforge_dev \
  -p 5432:5432 postgres:14-alpine
```

---

### Error: `peer authentication failed for user "promptforge"`

**Problem**: PostgreSQL authentication configuration

**Solution**:

1. Edit `pg_hba.conf`:
```bash
# Find the file
sudo find / -name pg_hba.conf 2>/dev/null

# macOS example: /opt/homebrew/var/postgresql@14/pg_hba.conf
# Linux example: /etc/postgresql/14/main/pg_hba.conf
```

2. Change this line:
```
# FROM:
local   all             all                                     peer

# TO:
local   all             all                                     md5
```

3. Restart PostgreSQL:
```bash
# macOS
brew services restart postgresql@14

# Linux
sudo systemctl restart postgresql
```

---

### Error: Jobs not being processed by worker

**Symptoms**:
- Worker starts successfully
- Jobs stay in "queued" status
- No error messages

**Solution**:

1. **Check DATABASE_URL in .env**:
```bash
cat backend/.env | grep DATABASE_URL
```

Should be:
```
DATABASE_URL=postgresql+asyncpg://promptforge:promptforge_dev@localhost:5432/promptforge
```

2. **Verify database has jobs**:
```bash
psql -U promptforge -d promptforge -c "SELECT COUNT(*) FROM pf_jobs WHERE status = 'queued';"
```

3. **Check worker logs** for connection errors:
```
Worker worker-test-1 initialized (max_concurrent=2)
Worker worker-test-1 started
```

4. **Manually test database connection from Python**:
```python
python3 -c "
from promptforge.infra.db import db
import asyncio

async def test():
    await db.connect()
    print('Connected successfully!')
    await db.disconnect()

asyncio.run(test())
"
```

---

### Error: `ImportError: cannot import name 'BaseSettings'`

**Full error**:
```
ImportError: cannot import name 'BaseSettings' from 'pydantic'
```

**Problem**: Wrong Pydantic version or missing pydantic-settings

**Solution**:
```bash
pip install pydantic-settings==2.1.0
```

---

### Error: Tesseract not found

**Full error**:
```
TesseractNotFoundError: tesseract is not installed or it's not in your PATH
```

**Solution**:

**macOS**:
```bash
brew install tesseract
```

**Ubuntu/Debian**:
```bash
sudo apt update
sudo apt install tesseract-ocr
```

**Windows**:
1. Download from: https://github.com/UB-Mannheim/tesseract/wiki
2. Add to PATH

**Verify**:
```bash
tesseract --version
```

---

### Error: API returns 500 Internal Server Error

**Symptoms**: API starts but returns 500 on requests

**Solution**:

1. **Check API logs**:
```bash
tail -f backend/pdf_processing.log
```

2. **Check for database connection**:
```bash
# In API startup logs, you should see:
# INFO: Application startup complete.
# INFO: Pipeline database connected
```

3. **Test health endpoint**:
```bash
curl http://localhost:8000/api/v1/pipeline/health
```

Should return:
```json
{"status": "healthy", "database": "connected", ...}
```

4. **Check database tables exist**:
```bash
psql -U promptforge -d promptforge -c "\dt"
```

Should show 6 tables starting with `pf_`

---

### Error: Jobs stuck in 'running' state

**Problem**: Worker crashed or killed without cleanup

**Solution**:

**Option 1 - Wait for Watchdog** (automatic):
The watchdog runs every 60 seconds and will reset jobs with stale heartbeats (>90 seconds old).

**Option 2 - Manual Reset** (immediate):
```sql
psql -U promptforge -d promptforge

UPDATE pf_jobs
SET status = 'queued',
    leased_by = NULL,
    leased_at = NULL,
    heartbeat_at = NULL,
    not_before = NOW()
WHERE status = 'running';
```

**Option 3 - Check if worker is actually running**:
```bash
ps aux | grep promptforge.workers
```

---

### Error: Permission denied creating storage directory

**Full error**:
```
PermissionError: [Errno 13] Permission denied: './data/storage'
```

**Solution**:

```bash
cd backend
mkdir -p data/storage
chmod 755 data/storage
```

Or change storage path in `.env`:
```bash
STORAGE_BASE_PATH=/tmp/promptforge_storage
```

---

### Error: Port 8000 already in use

**Full error**:
```
OSError: [Errno 48] Address already in use
```

**Solution**:

**Option 1 - Kill existing process**:
```bash
# Find process using port 8000
lsof -ti:8000 | xargs kill -9
```

**Option 2 - Use different port**:
```bash
# Edit main_with_pipeline.py, line ~175:
uvicorn.run(app, host="0.0.0.0", port=8001, reload=True)
```

---

### Error: Docker Compose fails to start

**Problem**: Various Docker-related issues

**Solution**:

1. **Check Docker is running**:
```bash
docker ps
```

2. **Check logs**:
```bash
docker-compose logs
```

3. **Rebuild containers**:
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up
```

4. **Check .env file exists**:
```bash
ls backend/.env
# If not, copy example:
cp backend/.env.example backend/.env
```

---

### Error: High memory usage

**Symptoms**: Worker or API using excessive RAM

**Solution**:

1. **Reduce worker concurrency**:
```bash
# In .env
WORKER_MAX_CONCURRENT_JOBS=1
```

2. **Limit worker count**:
```bash
# Instead of 5 workers, run 2:
docker-compose up --scale worker=2
```

3. **Check for memory leaks in custom adapters**

4. **Increase system memory** or run fewer concurrent jobs

---

### Error: `uvicorn: command not found`

**Problem**: Uvicorn not installed

**Solution**:
```bash
pip install uvicorn
# Or
pip install -r requirements.txt
```

---

### Error: `No module named 'promptforge'`

**Problem**: Running from wrong directory or module not in Python path

**Solution**:

1. **Ensure you're in backend directory**:
```bash
cd backend
python -m promptforge.cli setup
```

2. **Or add to PYTHONPATH**:
```bash
export PYTHONPATH="${PYTHONPATH}:/path/to/pdf-annotation-app/backend"
```

---

## 🧪 Diagnostic Tools

### Validate Installation

Run the validation script:
```bash
cd backend
python validate_installation.py
```

This will check:
- Python version
- Dependencies
- Database connection
- Database schema
- Pipeline configuration
- Storage directory
- Adapters
- Stage registry

### Database Health Check

```bash
psql -U promptforge -d promptforge

-- Check tables
\dt

-- Check active runs
SELECT COUNT(*) FROM pf_runs WHERE status = 'running';

-- Check queue depth
SELECT COUNT(*) FROM pf_jobs WHERE status = 'queued';

-- Check workers
SELECT DISTINCT leased_by, COUNT(*)
FROM pf_jobs
WHERE status = 'running'
AND heartbeat_at > NOW() - INTERVAL '2 minutes'
GROUP BY leased_by;
```

### API Health Check

```bash
curl http://localhost:8000/api/v1/pipeline/health
```

Should return:
```json
{
  "status": "healthy",
  "database": "connected",
  "active_workers": 1,
  "timestamp": "2025-11-02T..."
}
```

---

## 📞 Still Having Issues?

### Collect Diagnostic Information

1. **System Info**:
```bash
python --version
psql --version
tesseract --version
```

2. **Environment**:
```bash
cat backend/.env | grep -v PASSWORD
```

3. **Database Status**:
```bash
psql -U promptforge -d promptforge -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'pf_%';
"
```

4. **Recent Logs**:
```bash
tail -50 backend/pdf_processing.log
```

5. **Job Status**:
```bash
psql -U promptforge -d promptforge -c "
SELECT stage_key, status, COUNT(*) FROM pf_jobs
GROUP BY stage_key, status ORDER BY stage_key;
"
```

### Enable Debug Logging

```bash
# In .env
LOG_LEVEL=DEBUG

# Restart services to see detailed logs
```

---

## 💡 Pro Tips

1. **Always check logs first** - Most errors are explained in the logs
2. **Run validation script** - `python validate_installation.py`
3. **Test database connection** separately before running pipeline
4. **Start with one worker** - Easier to debug than multiple
5. **Use Docker** for clean environment if local setup fails
6. **Keep quick reference handy** - `QUICK_REFERENCE.md` has common commands

---

**If you find a new issue not listed here, please document it and the solution!**
