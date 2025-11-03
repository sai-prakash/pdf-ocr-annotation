"""
Classify Document stage - determines document type and fields
"""
from typing import Dict, Any
import logging
from .base import BaseStage
from ..models.domain import StageResult
from ..adapters.factory import AdapterFactory

logger = logging.getLogger(__name__)


class ClassifyDocStage(BaseStage):
    """Classify document type using LLM"""

    def __init__(self):
        self.storage = AdapterFactory.get_storage_adapter()
        self.classifier = AdapterFactory.get_classification_adapter()

    async def execute(self, input_data: Dict[str, Any]) -> StageResult:
        """
        Classify document type

        Input:
            - ocr_json_storage_key: Path to OCR results
            - doc_id: Document ID

        Output:
            - doc_type: Document type (e.g., "employment_agreement")
            - fields: List of field names to extract
            - confidence: Classification confidence
        """
        try:
            ocr_storage_key = input_data.get("ocr_json_storage_key")
            doc_id = input_data.get("doc_id")

            if not ocr_storage_key:
                raise ValueError("ocr_json_storage_key is required")

            logger.info(f"Starting document classification for doc_id={doc_id}")

            # Load OCR results
            ocr_data = await self.storage.download_json(ocr_storage_key)

            # Extract first page text for classification
            first_page_text = self._extract_page_text(ocr_data, page_num=0)

            # Classify document
            classification = await self.classifier.classify_document(
                text=first_page_text
            )

            doc_type = classification.get("doc_type")
            fields = classification.get("fields", [])
            confidence = classification.get("confidence", 0.0)

            logger.info(
                f"Classification complete: doc_id={doc_id}, "
                f"type={doc_type}, fields={len(fields)}, confidence={confidence:.2f}"
            )

            return StageResult(
                success=True,
                output={
                    "doc_type": doc_type,
                    "fields": fields,
                    "classification_confidence": confidence
                }
            )

        except Exception as e:
            return await self._handle_error(e)

    def _extract_page_text(self, ocr_data: Dict[str, Any], page_num: int = 0) -> str:
        """Extract full text from a page"""
        pages = ocr_data.get("pages", [])

        if page_num >= len(pages):
            return ""

        page = pages[page_num]
        lines = page.get("lines", [])

        # Concatenate all text
        text = " ".join(line.get("text", "") for line in lines)

        return text

    def get_stage_key(self) -> str:
        return "classify_doc"

    def get_timeout_seconds(self) -> int:
        return 90  # 1.5 minutes for classification
