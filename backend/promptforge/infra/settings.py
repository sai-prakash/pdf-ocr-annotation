"""
Configuration settings for PromptForge Pipeline
"""
from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    """Application settings with environment variable support"""

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://localhost/promptforge"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 5

    # Storage (S3 or FileSystem)
    STORAGE_BACKEND: str = "filesystem"  # "s3" or "filesystem"
    AWS_S3_BUCKET: Optional[str] = None
    AWS_REGION: str = "us-east-1"
    STORAGE_BASE_PATH: str = "./data/storage"  # For filesystem backend

    # OCR Provider
    OCR_PROVIDER: str = "tesseract"  # "tesseract", "easyocr", or custom
    OCR_CUSTOM_ENDPOINT: Optional[str] = None

    # LLM Provider
    LLM_PROVIDER: str = "azure"  # "azure", "openai", "custom"
    AZURE_OPENAI_API_KEY: Optional[str] = None
    AZURE_OPENAI_ENDPOINT: Optional[str] = None
    AZURE_OPENAI_DEPLOYMENT: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    LLM_CUSTOM_ENDPOINT: Optional[str] = None

    # Worker
    WORKER_ID: Optional[str] = None
    WORKER_MAX_CONCURRENT_JOBS: int = 2
    WORKER_HEARTBEAT_INTERVAL: int = 30

    # Watchdog
    WATCHDOG_INTERVAL: int = 60
    WATCHDOG_STALE_THRESHOLD: int = 90

    # Feature Flags
    USE_NEW_PIPELINE: bool = True
    ENABLE_IDEMPOTENCY_CACHE: bool = True

    # Logging
    LOG_LEVEL: str = "INFO"
    STRUCTURED_LOGGING: bool = True

    class Config:
        env_file = ".env"
        case_sensitive = False


# Global settings instance
settings = Settings()


# Helper to get worker ID
def get_worker_id() -> str:
    """Get or generate worker ID"""
    if settings.WORKER_ID:
        return settings.WORKER_ID

    # Use hostname or generate UUID
    import socket
    import uuid
    try:
        hostname = socket.gethostname()
        return f"worker-{hostname}"
    except:
        return f"worker-{uuid.uuid4().hex[:8]}"
