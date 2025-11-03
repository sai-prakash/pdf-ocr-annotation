"""
Auto-Annotate stage - extracts field values from document
"""
from typing import Dict, Any
import logging
from .base import BaseStage
from ..models.domain import StageResult
from ..adapters.factory import AdapterFactory

logger = logging.getLogger(__name__)


class AutoAnnotateStage(BaseStage):
    """Automatically extract and annotate document fields"""

    def __init__(self):
        self.storage = AdapterFactory.get_storage_adapter()
        self.annotator = AdapterFactory.get_annotation_adapter()

    async def execute(self, input_data: Dict[str, Any]) -> StageResult:
        """
        Extract field values from document

        Input:
            - ocr_json_storage_key: Path to OCR results
            - doc_type: Document type
            - fields: List of field names to extract
            - doc_id: Document ID

        Output:
            - annotations_json_storage_key: Path to annotations JSON
            - field_count: Number of fields extracted
            - llm_tokens_used: Total tokens consumed (if applicable)
        """
        try:
            ocr_storage_key = input_data.get("ocr_json_storage_key")
            doc_type = input_data.get("doc_type")
            fields = input_data.get("fields", [])
            doc_id = input_data.get("doc_id")
            storage_key = input_data.get("storage_key")  # Original document

            if not ocr_storage_key:
                raise ValueError("ocr_json_storage_key is required")

            if not fields:
                logger.warning(f"No fields to extract for doc_id={doc_id}")
                return StageResult(
                    success=True,
                    output={
                        "annotations_json_storage_key": None,
                        "field_count": 0,
                        "llm_tokens_used": 0
                    }
                )

            logger.info(
                f"Starting field extraction for doc_id={doc_id}, "
                f"type={doc_type}, fields={len(fields)}"
            )

            # Load OCR results
            ocr_data = await self.storage.download_json(ocr_storage_key)

            # Extract full document text
            doc_text = self._extract_full_text(ocr_data)

            # Extract annotations using LLM
            annotations = await self.annotator.extract_fields(
                doc_text=doc_text,
                doc_type=doc_type,
                fields=fields,
                ocr_data=ocr_data
            )

            # Calculate total tokens used (if available)
            total_tokens = sum(
                ann.get("tokens_used", 0) for ann in annotations
            )

            # Save annotations to storage
            annotations_data = {
                "annotations": annotations,
                "doc_type": doc_type,
                "field_count": len(annotations)
            }

            annotations_storage_key = ocr_storage_key.replace(
                "ocr_results.json", "annotations.json"
            )

            await self.storage.upload_json(annotations_data, annotations_storage_key)

            logger.info(
                f"Field extraction complete: doc_id={doc_id}, "
                f"fields={len(annotations)}, tokens={total_tokens}"
            )

            return StageResult(
                success=True,
                output={
                    "annotations_json_storage_key": annotations_storage_key,
                    "field_count": len(annotations)
                },
                tokens_used=total_tokens if total_tokens > 0 else None
            )

        except Exception as e:
            return await self._handle_error(e)

    def _extract_full_text(self, ocr_data: Dict[str, Any]) -> str:
        """Extract all text from all pages"""
        pages = ocr_data.get("pages", [])
        full_text = []

        for page in pages:
            lines = page.get("lines", [])
            page_text = " ".join(line.get("text", "") for line in lines)
            full_text.append(page_text)

        return "\n\n".join(full_text)

    def get_stage_key(self) -> str:
        return "auto_annotate"

    def get_timeout_seconds(self) -> int:
        return 300  # 5 minutes for annotation (may call LLM multiple times)
