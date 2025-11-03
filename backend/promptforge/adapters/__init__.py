"""Adapter layer - plug-and-play providers for storage, OCR, LLM"""
from .base import StorageAdapter, OCRAdapter, LLMAdapter, ClassificationAdapter, AnnotationAdapter
from .factory import AdapterFactory
from .storage_filesystem import FilesystemStorageAdapter
from .ocr_tesseract import TesseractOCRAdapter
from .llm_mock import MockLLMAdapter, MockClassificationAdapter, MockAnnotationAdapter

__all__ = [
    "StorageAdapter",
    "OCRAdapter",
    "LLMAdapter",
    "ClassificationAdapter",
    "AnnotationAdapter",
    "AdapterFactory",
    "FilesystemStorageAdapter",
    "TesseractOCRAdapter",
    "MockLLMAdapter",
    "MockClassificationAdapter",
    "MockAnnotationAdapter"
]
