#!/bin/bash

# PromptForge Pipeline Setup Script

set -e  # Exit on error

echo "========================================="
echo "PromptForge Pipeline Setup"
echo "========================================="

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed"
    exit 1
fi

echo "✓ Python 3 found"

# Install dependencies
echo ""
echo "Installing dependencies..."
pip install -r requirements.txt
pip install -r requirements_pipeline.txt

echo "✓ Dependencies installed"

# Check if PostgreSQL is running
echo ""
echo "Checking database connection..."

# Read DATABASE_URL from .env or use default
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

DATABASE_URL=${DATABASE_URL:-"postgresql+asyncpg://localhost/promptforge"}

echo "Database URL: $DATABASE_URL"

# Initialize database
echo ""
echo "Initializing database schema..."
python -m promptforge.cli init-db

if [ $? -eq 0 ]; then
    echo "✓ Database schema initialized"
else
    echo "ERROR: Failed to initialize database schema"
    exit 1
fi

# Load default pipeline
echo ""
echo "Loading default pipeline configuration..."
python -m promptforge.cli load-pipeline

if [ $? -eq 0 ]; then
    echo "✓ Default pipeline loaded"
else
    echo "ERROR: Failed to load default pipeline"
    exit 1
fi

echo ""
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Update .env with your configuration"
echo "  2. Start the API server: python main_with_pipeline.py"
echo "  3. Start a worker: python -m promptforge.workers.loop"
echo "  4. Start the scheduler: python -m promptforge.scheduler.watchdog"
echo ""
echo "Or use Docker Compose:"
echo "  docker-compose up"
echo ""
echo "Documentation: See PROMPTFORGE_README.md"
echo ""
