"""
Base adapter interfaces for plug-and-play architecture
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from pathlib import Path


class StorageAdapter(ABC):
    """Abstract interface for storage backends (S3, filesystem, etc.)"""

    @abstractmethod
    async def upload_file(self, local_path: str, storage_key: str) -> str:
        """
        Upload file to storage

        Args:
            local_path: Path to local file
            storage_key: Key/path in storage

        Returns:
            Storage URL or key
        """
        pass

    @abstractmethod
    async def download_file(self, storage_key: str, local_path: str):
        """
        Download file from storage

        Args:
            storage_key: Key/path in storage
            local_path: Path to save file locally
        """
        pass

    @abstractmethod
    async def download_to_temp(self, storage_key: str) -> str:
        """
        Download file to temporary location

        Args:
            storage_key: Key/path in storage

        Returns:
            Path to temporary file
        """
        pass

    @abstractmethod
    async def upload_json(self, data: dict, storage_key: str) -> str:
        """
        Upload JSON data to storage

        Args:
            data: Dictionary to save as JSON
            storage_key: Key/path in storage

        Returns:
            Storage URL or key
        """
        pass

    @abstractmethod
    async def download_json(self, storage_key: str) -> dict:
        """
        Download and parse JSON from storage

        Args:
            storage_key: Key/path in storage

        Returns:
            Parsed JSON dictionary
        """
        pass

    @abstractmethod
    async def delete_file(self, storage_key: str):
        """
        Delete file from storage

        Args:
            storage_key: Key/path in storage
        """
        pass

    @abstractmethod
    async def file_exists(self, storage_key: str) -> bool:
        """
        Check if file exists in storage

        Args:
            storage_key: Key/path in storage

        Returns:
            True if file exists
        """
        pass


class OCRAdapter(ABC):
    """Abstract interface for OCR providers"""

    @abstractmethod
    async def extract_text(self, file_path: str) -> Dict[str, Any]:
        """
        Extract text and bounding boxes from document

        Args:
            file_path: Path to document (PDF, image, etc.)

        Returns:
            Dictionary with structure:
            {
                "pages": [
                    {
                        "page": 1,
                        "lines": [
                            {
                                "bbox": [x0, y0, x1, y1],
                                "text": "extracted text",
                                "confidence": 0.95
                            }
                        ]
                    }
                ]
            }
        """
        pass

    @abstractmethod
    def get_provider_name(self) -> str:
        """Return provider name (e.g., 'tesseract', 'easyocr')"""
        pass


class LLMAdapter(ABC):
    """Abstract interface for LLM providers"""

    @abstractmethod
    async def complete(
        self,
        prompt: str,
        model: str = "gpt-4",
        temperature: float = 0.1,
        max_tokens: int = 2000,
        response_format: str = "text"
    ) -> Dict[str, Any]:
        """
        Generate LLM completion

        Args:
            prompt: Input prompt
            model: Model identifier
            temperature: Sampling temperature
            max_tokens: Maximum tokens in response
            response_format: "text" or "json"

        Returns:
            Dictionary with structure:
            {
                "content": "response text",
                "tokens_used": 150,
                "cost_usd": 0.0045
            }
        """
        pass

    @abstractmethod
    def get_provider_name(self) -> str:
        """Return provider name (e.g., 'azure', 'openai')"""
        pass


class ClassificationAdapter(ABC):
    """Abstract interface for document classification"""

    @abstractmethod
    async def classify_document(
        self,
        text: str,
        available_types: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Classify document type

        Args:
            text: Document text (usually first page)
            available_types: Optional list of valid document types

        Returns:
            Dictionary with structure:
            {
                "doc_type": "employment_agreement",
                "fields": ["employee_name", "start_date", "salary"],
                "confidence": 0.92
            }
        """
        pass


class AnnotationAdapter(ABC):
    """Abstract interface for field extraction/annotation"""

    @abstractmethod
    async def extract_fields(
        self,
        doc_text: str,
        doc_type: str,
        fields: List[str],
        ocr_data: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Extract field values from document

        Args:
            doc_text: Full document text
            doc_type: Document type classification
            fields: List of field names to extract
            ocr_data: Optional OCR data with bounding boxes

        Returns:
            List of annotations:
            [
                {
                    "field": "employee_name",
                    "answer": "John Smith",
                    "reasoning": "Found in header",
                    "contexts": ["Employee Name: John Smith"],
                    "page": 1,
                    "bbox": [120, 45, 280, 60],
                    "confidence": 0.92
                }
            ]
        """
        pass
