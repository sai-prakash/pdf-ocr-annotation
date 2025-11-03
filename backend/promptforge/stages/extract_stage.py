"""
Extract Text stage - performs OCR on document
"""
from typing import Dict, Any
import logging
from .base import BaseStage
from ..models.domain import StageResult
from ..adapters.factory import AdapterFactory

logger = logging.getLogger(__name__)


class ExtractTextStage(BaseStage):
    """Extract text and bounding boxes using OCR"""

    def __init__(self):
        self.storage = AdapterFactory.get_storage_adapter()
        self.ocr = AdapterFactory.get_ocr_adapter()

    async def execute(self, input_data: Dict[str, Any]) -> StageResult:
        """
        Extract text from document using OCR

        Input:
            - storage_key: Path to document in storage
            - doc_id: Document ID

        Output:
            - ocr_json_storage_key: Path to OCR results JSON
            - page_count: Number of pages processed
        """
        try:
            storage_key = input_data.get("storage_key")
            doc_id = input_data.get("doc_id")

            if not storage_key:
                raise ValueError("storage_key is required")

            logger.info(f"Starting OCR extraction for doc_id={doc_id}")

            # Download file from storage
            local_path = await self.storage.download_to_temp(storage_key)

            try:
                # Run OCR
                ocr_results = await self.ocr.extract_text(local_path)

                # Generate storage key for OCR results
                ocr_storage_key = storage_key.replace(
                    "/original.", "/ocr_results."
                ).rsplit(".", 1)[0] + ".json"

                # Save OCR results to storage
                await self.storage.upload_json(ocr_results, ocr_storage_key)

                page_count = len(ocr_results.get("pages", []))

                logger.info(
                    f"OCR extraction complete: doc_id={doc_id}, "
                    f"pages={page_count}, key={ocr_storage_key}"
                )

                return StageResult(
                    success=True,
                    output={
                        "ocr_json_storage_key": ocr_storage_key,
                        "page_count": page_count
                    }
                )

            finally:
                # Clean up temp file
                import os
                if os.path.exists(local_path):
                    os.remove(local_path)

        except Exception as e:
            return await self._handle_error(e)

    def get_stage_key(self) -> str:
        return "extract_text"

    def get_timeout_seconds(self) -> int:
        return 300  # 5 minutes for OCR
