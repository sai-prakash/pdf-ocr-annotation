#!/bin/bash

# Activate virtual environment
source venv/bin/activate

# Start the server
echo "Starting PDF Annotation Backend on http://localhost:8000"
python3.9 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
