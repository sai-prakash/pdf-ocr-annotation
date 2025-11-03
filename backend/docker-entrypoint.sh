#!/bin/bash
set -e

echo "==================================="
echo "PromptForge Docker Entrypoint"
echo "==================================="

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL..."
max_attempts=30
attempt=0

while ! python3 -c "import asyncio; from promptforge.infra.db import db; asyncio.run(db.connect()); asyncio.run(db.fetchval('SELECT 1')); asyncio.run(db.disconnect())" 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ $attempt -eq $max_attempts ]; then
        echo "ERROR: PostgreSQL is not available after $max_attempts attempts"
        exit 1
    fi
    echo "PostgreSQL is unavailable - sleeping (attempt $attempt/$max_attempts)"
    sleep 2
done

echo "PostgreSQL is ready!"

# Check if schema is initialized
echo "Checking database schema..."
TABLES_EXIST=$(python3 -c "
import asyncio
from promptforge.infra.db import db

async def check():
    await db.connect()
    result = await db.fetchval(\"\"\"
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'pf_%'
    \"\"\")
    await db.disconnect()
    print(result)

asyncio.run(check())
" 2>/dev/null || echo "0")

if [ "$TABLES_EXIST" -eq "0" ]; then
    echo "Database schema not initialized. Initializing..."
    python3 -m promptforge.cli setup
    echo "Database schema initialized!"
else
    echo "Database schema already exists ($TABLES_EXIST tables found)"
fi

echo "==================================="
echo "Starting: $@"
echo "==================================="

# Execute the command passed to the entrypoint
exec "$@"
