"""
Filesystem storage adapter implementation
"""
import json
import shutil
from pathlib import Path
from typing import Dict, Any
import logging
from .base import StorageAdapter

logger = logging.getLogger(__name__)


class FilesystemStorageAdapter(StorageAdapter):
    """Storage adapter using local filesystem"""

    def __init__(self, base_path: str = "./data/storage"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Initialized filesystem storage at: {self.base_path}")

    def _get_full_path(self, storage_key: str) -> Path:
        """Convert storage key to full local path"""
        # Remove leading slash if present
        key = storage_key.lstrip("/")
        full_path = self.base_path / key
        # Create parent directories
        full_path.parent.mkdir(parents=True, exist_ok=True)
        return full_path

    async def upload_file(self, local_path: str, storage_key: str) -> str:
        """Upload file by copying to storage directory"""
        src = Path(local_path)
        dest = self._get_full_path(storage_key)

        if not src.exists():
            raise FileNotFoundError(f"Source file not found: {local_path}")

        shutil.copy2(src, dest)
        logger.info(f"Uploaded file: {storage_key}")

        return storage_key

    async def download_file(self, storage_key: str, local_path: str):
        """Download file by copying from storage directory"""
        src = self._get_full_path(storage_key)
        dest = Path(local_path)

        if not src.exists():
            raise FileNotFoundError(f"Storage file not found: {storage_key}")

        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        logger.debug(f"Downloaded file: {storage_key} -> {local_path}")

    async def download_to_temp(self, storage_key: str) -> str:
        """Download file to temporary location"""
        import tempfile
        import uuid

        src = self._get_full_path(storage_key)

        if not src.exists():
            raise FileNotFoundError(f"Storage file not found: {storage_key}")

        # Create temp file with same extension
        suffix = src.suffix
        temp_path = Path(tempfile.gettempdir()) / f"pf_temp_{uuid.uuid4().hex}{suffix}"

        shutil.copy2(src, temp_path)
        logger.debug(f"Downloaded to temp: {storage_key} -> {temp_path}")

        return str(temp_path)

    async def upload_json(self, data: dict, storage_key: str) -> str:
        """Upload JSON data"""
        dest = self._get_full_path(storage_key)

        with open(dest, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.info(f"Uploaded JSON: {storage_key}")
        return storage_key

    async def download_json(self, storage_key: str) -> dict:
        """Download and parse JSON"""
        src = self._get_full_path(storage_key)

        if not src.exists():
            raise FileNotFoundError(f"Storage file not found: {storage_key}")

        with open(src, 'r', encoding='utf-8') as f:
            data = json.load(f)

        logger.debug(f"Downloaded JSON: {storage_key}")
        return data

    async def delete_file(self, storage_key: str):
        """Delete file from storage"""
        path = self._get_full_path(storage_key)

        if path.exists():
            path.unlink()
            logger.info(f"Deleted file: {storage_key}")
        else:
            logger.warning(f"File not found for deletion: {storage_key}")

    async def file_exists(self, storage_key: str) -> bool:
        """Check if file exists"""
        return self._get_full_path(storage_key).exists()
