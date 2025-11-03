"""
Tesseract OCR adapter wrapping existing PDFProcessor
"""
from typing import Dict, Any
import logging
import sys
from pathlib import Path

# Add parent directory to path to import existing services
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.pdf_processor import PDFProcessor
from .base import OCRAdapter

logger = logging.getLogger(__name__)


class TesseractOCRAdapter(OCRAdapter):
    """OCR adapter using Tesseract via existing PDFProcessor"""

    def __init__(self):
        self.processor = PDFProcessor()
        logger.info("Initialized Tesseract OCR adapter")

    async def extract_text(self, file_path: str) -> Dict[str, Any]:
        """
        Extract text using existing PDF processor

        Args:
            file_path: Path to PDF file

        Returns:
            OCR results in standardized format
        """
        logger.info(f"Starting OCR extraction: {file_path}")

        # Use existing processor
        result = await self.processor.process_pdf(file_path)

        # Convert to standardized format
        pages = []

        for page_data in result["pages"]:
            lines = []

            for block in page_data["blocks"]:
                bbox = block["bbox"]

                lines.append({
                    "bbox": [
                        bbox["x0"],
                        bbox["y0"],
                        bbox["x1"],
                        bbox["y1"]
                    ],
                    "text": block["text"],
                    "confidence": block.get("confidence", 1.0)
                })

            pages.append({
                "page": page_data["page_number"],
                "lines": lines,
                "width": page_data.get("width"),
                "height": page_data.get("height")
            })

        ocr_result = {
            "pages": pages,
            "page_count": len(pages),
            "provider": "tesseract"
        }

        logger.info(f"OCR extraction complete: {len(pages)} pages, {sum(len(p['lines']) for p in pages)} text blocks")

        return ocr_result

    def get_provider_name(self) -> str:
        """Return provider name"""
        return "tesseract"
