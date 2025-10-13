import fitz  # PyMuPDF
import easyocr
import numpy as np
from PIL import Image
import io
import hashlib
import json
import os
import time
import logging
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import cv2
import re

logger = logging.getLogger(__name__)


class PDFProcessor:
    def __init__(self):
        self.reader = None  # Lazy load EasyOCR
        self.data_dir = Path("data")
        self.data_dir.mkdir(exist_ok=True)

    def _get_ocr_reader(self):
        """Lazy load EasyOCR reader with optimized settings"""
        if self.reader is None:
            logger.info("[OCR] Initializing EasyOCR reader...")
            self.reader = easyocr.Reader(
                ['en'],
                gpu=False,  # Set to True if GPU available
                verbose=False
            )
            logger.info("[OCR] EasyOCR reader initialized")
        return self.reader

    def _generate_pdf_id(self, file_path: str) -> str:
        """Generate unique ID for PDF"""
        with open(file_path, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()

    def _should_run_ocr(self, page: fitz.Page) -> Tuple[bool, bool]:
        """
        Determine if page needs OCR and if it has native text.
        Returns: (has_native_text, should_run_ocr)
        """
        text = page.get_text().strip()
        has_native_text = len(text) > 10  # Has some readable text

        # Check for images on the page
        image_list = page.get_images()
        has_images = len(image_list) > 0

        # Run OCR if:
        # 1. Page has images (might contain text in images)
        # 2. OR page has very little native text (< 50 chars)
        should_run_ocr = has_images or len(text) < 50

        return has_native_text, should_run_ocr

    def _extract_text_pymupdf(self, page: fitz.Page) -> List[Dict]:
        """Extract text with bounding boxes using PyMuPDF"""
        blocks = []

        # Get text with detailed information
        text_dict = page.get_text("dict")
        page_height = page.rect.height

        for block in text_dict["blocks"]:
            if block["type"] == 0:  # Text block
                for line in block["lines"]:
                    for span in line["spans"]:
                        bbox = span["bbox"]
                        text = span["text"]

                        if text.strip():
                            # Convert bbox coordinates (x0, y0, x1, y1)
                            blocks.append({
                                "text": text,
                                "bbox": {
                                    "x0": bbox[0],
                                    "y0": bbox[1],
                                    "x1": bbox[2],
                                    "y1": bbox[3],
                                },
                                "confidence": 1.0,
                                "type": "native"
                            })

        return blocks

    def _is_valid_text(self, text: str) -> bool:
        """
        Validate if extracted text is likely real text (quality control)
        """
        if not text or len(text.strip()) == 0:
            return False

        # Must have at least one letter
        if not any(c.isalpha() for c in text):
            return False

        # Ratio of alphanumeric characters should be reasonable
        alphanumeric = sum(c.isalnum() or c.isspace() for c in text)
        if len(text) > 0 and alphanumeric / len(text) < 0.5:
            return False

        return True

    def _extract_text_ocr(self, page: fitz.Page, page_num: int = 0) -> List[Dict]:
        """
        SIMPLIFIED: Extract text from scanned page using EasyOCR with minimal optimization
        """
        start_time = time.time()

        # Convert to image at 2.0x resolution (better for EasyOCR)
        logger.info(f"[OCR] Page {page_num + 1}: Converting to image at 2.0x resolution...")
        pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))

        # Convert to numpy array
        img_data = pix.tobytes("png")
        image = Image.open(io.BytesIO(img_data))
        img_array = np.array(image)

        logger.info(f"[OCR] Page {page_num + 1}: Image size {img_array.shape}, starting OCR...")

        # Get OCR reader
        reader = self._get_ocr_reader()

        # Run EasyOCR with optimized parameters
        results = reader.readtext(
            img_array,
            paragraph=False,
            batch_size=1
        )

        logger.info(f"[OCR] Page {page_num + 1}: Found {len(results)} text blocks")

        # Process results
        blocks = []
        page_height = page.rect.height
        page_width = page.rect.width

        # Calculate scale factor
        scale_x = page_width / pix.width
        scale_y = page_height / pix.height

        for detection in results:
            bbox_points = detection[0]
            text = detection[1]
            confidence = detection[2]

            # Only filter extremely low confidence
            if confidence < 0.2 or not text.strip():
                continue

            # Convert bbox to x0, y0, x1, y1 format
            x_coords = [p[0] for p in bbox_points]
            y_coords = [p[1] for p in bbox_points]

            x0 = min(x_coords) * scale_x
            y0 = min(y_coords) * scale_y
            x1 = max(x_coords) * scale_x
            y1 = max(y_coords) * scale_y

            blocks.append({
                "text": text,
                "bbox": {
                    "x0": x0,
                    "y0": y0,
                    "x1": x1,
                    "y1": y1,
                },
                "confidence": confidence,
                "type": "ocr"
            })

        total_time = time.time() - start_time
        avg_confidence = np.mean([b['confidence'] for b in blocks]) if blocks else 0

        logger.info(
            f"[OCR] Page {page_num + 1}: Completed in {total_time:.2f}s, "
            f"{len(blocks)} blocks, avg confidence: {avg_confidence:.2f}"
        )

        return blocks

    def _merge_text_blocks(self, blocks: List[Dict]) -> Dict:
        """Merge text blocks and create searchable text"""
        full_text = " ".join([block["text"] for block in blocks])

        return {
            "blocks": blocks,
            "full_text": full_text,
            "block_count": len(blocks)
        }

    async def process_pdf(self, file_path: str) -> Dict:
        """Process PDF and extract text with bounding boxes"""
        pdf_id = self._generate_pdf_id(file_path)
        doc = fitz.open(file_path)

        total_pages = len(doc)
        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)

        logger.info(f"[PDF] Starting processing: {total_pages} pages, {file_size_mb:.2f} MB")

        pages_data = []
        start_time = time.time()

        for page_num in range(total_pages):
            page_start = time.time()
            page = doc[page_num]

            # Determine extraction strategy
            has_native_text, should_run_ocr = self._should_run_ocr(page)

            # Determine page type for logging
            if has_native_text and should_run_ocr:
                page_type = "HYBRID (Native + OCR)"
            elif should_run_ocr:
                page_type = "SCANNED (OCR only)"
            else:
                page_type = "NATIVE (Text only)"

            logger.info(f"[PDF] Processing page {page_num + 1}/{total_pages} ({page_type})")

            blocks = []

            # Extract native text if available
            if has_native_text:
                native_blocks = self._extract_text_pymupdf(page)
                blocks.extend(native_blocks)
                logger.info(f"[PDF] Page {page_num + 1}: Extracted {len(native_blocks)} native text blocks")

            # Run OCR if needed (images present or insufficient native text)
            if should_run_ocr:
                ocr_blocks = self._extract_text_ocr(page, page_num)
                blocks.extend(ocr_blocks)
                logger.info(f"[PDF] Page {page_num + 1}: Extracted {len(ocr_blocks)} OCR text blocks")

            # Merge and organize text
            page_data = self._merge_text_blocks(blocks)
            page_data.update({
                "page_number": page_num + 1,
                "is_scanned": should_run_ocr and not has_native_text,  # True only if purely scanned
                "has_native_text": has_native_text,
                "has_ocr_text": should_run_ocr,
                "width": page.rect.width,
                "height": page.rect.height
            })

            pages_data.append(page_data)

            page_time = time.time() - page_start
            logger.info(f"[PDF] Page {page_num + 1}/{total_pages} completed in {page_time:.2f}s ({len(blocks)} total blocks)")

        total_time = time.time() - start_time
        logger.info(f"[PDF] Processing complete: {total_pages} pages in {total_time:.2f}s ({total_time/total_pages:.2f}s per page)")

        # Save extracted data
        result = {
            "pdf_id": pdf_id,
            "file_path": file_path,
            "total_pages": len(doc),
            "pages": pages_data
        }

        # Save to JSON
        output_path = self.data_dir / f"{pdf_id}.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        doc.close()

        return result

    async def get_pdf_data(self, pdf_id: str) -> Optional[Dict]:
        """Retrieve stored PDF data"""
        data_path = self.data_dir / f"{pdf_id}.json"

        if not data_path.exists():
            return None

        with open(data_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    async def get_page_data(self, pdf_id: str, page_number: int) -> Optional[Dict]:
        """Get data for a specific page"""
        pdf_data = await self.get_pdf_data(pdf_id)

        if not pdf_data:
            return None

        for page in pdf_data["pages"]:
            if page["page_number"] == page_number:
                return page

        return None

    async def search_text(self, pdf_id: str, query: str) -> List[Dict]:
        """Search for text in PDF and return matching blocks with locations"""
        pdf_data = await self.get_pdf_data(pdf_id)

        if not pdf_data:
            return []

        results = []
        query_lower = query.lower()

        for page in pdf_data["pages"]:
            page_number = page["page_number"]

            # Search in each text block
            for block in page["blocks"]:
                text = block["text"]
                text_lower = text.lower()

                # Find all occurrences
                start = 0
                while True:
                    idx = text_lower.find(query_lower, start)
                    if idx == -1:
                        break

                    results.append({
                        "page_number": page_number,
                        "text": text,
                        "matched_text": text[idx:idx + len(query)],
                        "bbox": block["bbox"],
                        "context_start": max(0, idx - 20),
                        "context_end": min(len(text), idx + len(query) + 20),
                        "match_index": idx
                    })

                    start = idx + 1

        return results
