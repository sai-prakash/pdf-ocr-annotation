"""
Upload stage - uploads document to storage
"""
from typing import Dict, Any
import os
import logging
from .base import BaseStage
from ..models.domain import StageResult
from ..adapters.factory import AdapterFactory

logger = logging.getLogger(__name__)


class UploadStage(BaseStage):
    """Upload document to storage (S3 or filesystem)"""

    def __init__(self):
        self.storage = AdapterFactory.get_storage_adapter()

    async def execute(self, input_data: Dict[str, Any]) -> StageResult:
        """
        Upload file to storage

        Input:
            - file_path: Path to local file
            - project_id: Project ID
            - doc_id: Document ID
            - original_filename: Optional original filename

        Output:
            - storage_key: Key/path in storage
            - file_size_bytes: File size
        """
        try:
            file_path = input_data.get("file_path")
            project_id = input_data.get("project_id")
            doc_id = input_data.get("doc_id")
            original_filename = input_data.get("original_filename", "document.pdf")

            if not file_path:
                raise ValueError("file_path is required")

            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File not found: {file_path}")

            # Determine file extension
            _, ext = os.path.splitext(original_filename)

            # Generate storage key
            storage_key = f"projects/{project_id}/docs/{doc_id}/original{ext}"

            # Upload file
            await self.storage.upload_file(file_path, storage_key)

            # Get file size
            file_size = os.path.getsize(file_path)

            logger.info(
                f"Uploaded document: doc_id={doc_id}, "
                f"size={file_size} bytes, key={storage_key}"
            )

            return StageResult(
                success=True,
                output={
                    "storage_key": storage_key,
                    "file_size_bytes": file_size,
                    "original_filename": original_filename
                }
            )

        except Exception as e:
            return await self._handle_error(e)

    def get_stage_key(self) -> str:
        return "upload"

    def get_timeout_seconds(self) -> int:
        return 60  # 1 minute for upload
