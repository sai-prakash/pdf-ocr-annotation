"""
Adapter factory for plug-and-play provider selection
"""
from typing import Optional
import logging
from ..infra.settings import settings
from .base import StorageAdapter, OCRAdapter, LLMAdapter, ClassificationAdapter, AnnotationAdapter
from .storage_filesystem import FilesystemStorageAdapter
from .ocr_tesseract import TesseractOCRAdapter
from .llm_mock import MockLLMAdapter, MockClassificationAdapter, MockAnnotationAdapter

logger = logging.getLogger(__name__)


class AdapterFactory:
    """
    Factory for creating adapter instances based on configuration

    Enables plug-and-play architecture where users can swap providers
    by changing config or passing custom adapters
    """

    _storage_adapter: Optional[StorageAdapter] = None
    _ocr_adapter: Optional[OCRAdapter] = None
    _llm_adapter: Optional[LLMAdapter] = None
    _classification_adapter: Optional[ClassificationAdapter] = None
    _annotation_adapter: Optional[AnnotationAdapter] = None

    @classmethod
    def get_storage_adapter(
        cls,
        custom_adapter: Optional[StorageAdapter] = None
    ) -> StorageAdapter:
        """
        Get storage adapter instance

        Args:
            custom_adapter: Optional custom adapter to use

        Returns:
            StorageAdapter instance
        """
        if custom_adapter:
            logger.info(f"Using custom storage adapter: {type(custom_adapter).__name__}")
            cls._storage_adapter = custom_adapter
            return custom_adapter

        if cls._storage_adapter:
            return cls._storage_adapter

        # Create based on config
        backend = settings.STORAGE_BACKEND.lower()

        if backend == "filesystem":
            cls._storage_adapter = FilesystemStorageAdapter(
                base_path=settings.STORAGE_BASE_PATH
            )
        elif backend == "s3":
            # TODO: Implement S3 adapter
            from .storage_s3 import S3StorageAdapter
            cls._storage_adapter = S3StorageAdapter(
                bucket=settings.AWS_S3_BUCKET,
                region=settings.AWS_REGION
            )
        else:
            raise ValueError(f"Unknown storage backend: {backend}")

        logger.info(f"Initialized storage adapter: {backend}")
        return cls._storage_adapter

    @classmethod
    def get_ocr_adapter(
        cls,
        custom_adapter: Optional[OCRAdapter] = None
    ) -> OCRAdapter:
        """
        Get OCR adapter instance

        Args:
            custom_adapter: Optional custom adapter to use

        Returns:
            OCRAdapter instance
        """
        if custom_adapter:
            logger.info(f"Using custom OCR adapter: {type(custom_adapter).__name__}")
            cls._ocr_adapter = custom_adapter
            return custom_adapter

        if cls._ocr_adapter:
            return cls._ocr_adapter

        # Create based on config
        provider = settings.OCR_PROVIDER.lower()

        if provider == "tesseract":
            cls._ocr_adapter = TesseractOCRAdapter()
        elif provider == "easyocr":
            # TODO: Implement EasyOCR adapter
            from .ocr_easyocr import EasyOCRAdapter
            cls._ocr_adapter = EasyOCRAdapter()
        elif provider == "custom":
            # Custom endpoint
            from .ocr_custom import CustomOCRAdapter
            cls._ocr_adapter = CustomOCRAdapter(
                endpoint=settings.OCR_CUSTOM_ENDPOINT
            )
        else:
            raise ValueError(f"Unknown OCR provider: {provider}")

        logger.info(f"Initialized OCR adapter: {provider}")
        return cls._ocr_adapter

    @classmethod
    def get_llm_adapter(
        cls,
        custom_adapter: Optional[LLMAdapter] = None
    ) -> LLMAdapter:
        """
        Get LLM adapter instance

        Args:
            custom_adapter: Optional custom adapter to use

        Returns:
            LLMAdapter instance
        """
        if custom_adapter:
            logger.info(f"Using custom LLM adapter: {type(custom_adapter).__name__}")
            cls._llm_adapter = custom_adapter
            return custom_adapter

        if cls._llm_adapter:
            return cls._llm_adapter

        # Create based on config
        provider = settings.LLM_PROVIDER.lower()

        if provider == "mock":
            cls._llm_adapter = MockLLMAdapter()
        elif provider == "azure":
            # TODO: Implement Azure OpenAI adapter with actual credentials
            from .llm_mock import AzureOpenAIAdapter
            cls._llm_adapter = AzureOpenAIAdapter(
                api_key=settings.AZURE_OPENAI_API_KEY,
                endpoint=settings.AZURE_OPENAI_ENDPOINT,
                deployment=settings.AZURE_OPENAI_DEPLOYMENT
            )
        elif provider == "openai":
            # TODO: Implement OpenAI adapter
            from .llm_openai import OpenAIAdapter
            cls._llm_adapter = OpenAIAdapter(
                api_key=settings.OPENAI_API_KEY
            )
        elif provider == "custom":
            # Custom endpoint
            from .llm_custom import CustomLLMAdapter
            cls._llm_adapter = CustomLLMAdapter(
                endpoint=settings.LLM_CUSTOM_ENDPOINT
            )
        else:
            raise ValueError(f"Unknown LLM provider: {provider}")

        logger.info(f"Initialized LLM adapter: {provider}")
        return cls._llm_adapter

    @classmethod
    def get_classification_adapter(
        cls,
        custom_adapter: Optional[ClassificationAdapter] = None
    ) -> ClassificationAdapter:
        """
        Get classification adapter instance

        Args:
            custom_adapter: Optional custom adapter to use

        Returns:
            ClassificationAdapter instance
        """
        if custom_adapter:
            logger.info(f"Using custom classification adapter: {type(custom_adapter).__name__}")
            cls._classification_adapter = custom_adapter
            return custom_adapter

        if cls._classification_adapter:
            return cls._classification_adapter

        # Default to mock for now
        cls._classification_adapter = MockClassificationAdapter()

        logger.info("Initialized classification adapter: mock")
        return cls._classification_adapter

    @classmethod
    def get_annotation_adapter(
        cls,
        custom_adapter: Optional[AnnotationAdapter] = None
    ) -> AnnotationAdapter:
        """
        Get annotation adapter instance

        Args:
            custom_adapter: Optional custom adapter to use

        Returns:
            AnnotationAdapter instance
        """
        if custom_adapter:
            logger.info(f"Using custom annotation adapter: {type(custom_adapter).__name__}")
            cls._annotation_adapter = custom_adapter
            return custom_adapter

        if cls._annotation_adapter:
            return cls._annotation_adapter

        # Default to mock for now
        cls._annotation_adapter = MockAnnotationAdapter()

        logger.info("Initialized annotation adapter: mock")
        return cls._annotation_adapter

    @classmethod
    def reset(cls):
        """Reset all cached adapters (useful for testing)"""
        cls._storage_adapter = None
        cls._ocr_adapter = None
        cls._llm_adapter = None
        cls._classification_adapter = None
        cls._annotation_adapter = None
        logger.info("Reset all adapter instances")
