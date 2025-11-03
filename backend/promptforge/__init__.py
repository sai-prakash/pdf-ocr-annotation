"""
PromptForge - Pipeline Orchestration Infrastructure for Document Processing

A DAG-driven orchestration layer for asynchronous document processing with:
- Postgres-based job queue (no SQS/Redis)
- Retry logic with exponential backoff
- Watchdog recovery and DLQ
- Plug-and-play adapter architecture
"""

__version__ = "1.0.0"
