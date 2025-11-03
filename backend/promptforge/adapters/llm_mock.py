"""
Mock LLM adapter for testing (replace with actual Azure/OpenAI implementation)
"""
from typing import Dict, Any
import logging
import json
from .base import LLMAdapter, ClassificationAdapter, AnnotationAdapter

logger = logging.getLogger(__name__)


class MockLLMAdapter(LLMAdapter):
    """Mock LLM adapter for testing purposes"""

    async def complete(
        self,
        prompt: str,
        model: str = "gpt-4",
        temperature: float = 0.1,
        max_tokens: int = 2000,
        response_format: str = "text"
    ) -> Dict[str, Any]:
        """Generate mock LLM completion"""

        logger.info(f"Mock LLM call: model={model}, format={response_format}")

        # Mock response
        if response_format == "json":
            content = json.dumps({
                "result": "mock_response",
                "message": "This is a mock LLM response"
            })
        else:
            content = "This is a mock LLM response for testing."

        return {
            "content": content,
            "tokens_used": 50,
            "cost_usd": 0.001
        }

    def get_provider_name(self) -> str:
        return "mock"


class MockClassificationAdapter(ClassificationAdapter):
    """Mock document classification"""

    async def classify_document(
        self,
        text: str,
        available_types: list = None
    ) -> Dict[str, Any]:
        """Mock document classification"""

        logger.info("Mock document classification")

        return {
            "doc_type": "contract",
            "fields": ["party_a", "party_b", "date", "amount"],
            "confidence": 0.95
        }


class MockAnnotationAdapter(AnnotationAdapter):
    """Mock field extraction"""

    async def extract_fields(
        self,
        doc_text: str,
        doc_type: str,
        fields: list,
        ocr_data: Dict[str, Any] = None
    ) -> list:
        """Mock field extraction"""

        logger.info(f"Mock field extraction for {len(fields)} fields")

        annotations = []
        for i, field in enumerate(fields):
            annotations.append({
                "field": field,
                "answer": f"Mock value for {field}",
                "reasoning": f"Mock reasoning for {field}",
                "contexts": [f"Context mentioning {field}"],
                "page": 1,
                "bbox": [100 + i * 10, 100, 200 + i * 10, 120],
                "confidence": 0.85
            })

        return annotations


# Example: Azure OpenAI adapter (you can implement this later)
class AzureOpenAIAdapter(LLMAdapter):
    """
    Azure OpenAI adapter - implement using your actual Azure credentials

    Example implementation:
    """

    def __init__(self, api_key: str, endpoint: str, deployment: str):
        self.api_key = api_key
        self.endpoint = endpoint
        self.deployment = deployment
        # TODO: Initialize Azure OpenAI client

    async def complete(
        self,
        prompt: str,
        model: str = "gpt-4",
        temperature: float = 0.1,
        max_tokens: int = 2000,
        response_format: str = "text"
    ) -> Dict[str, Any]:
        """
        TODO: Implement actual Azure OpenAI API call

        Example:
        ```python
        from openai import AsyncAzureOpenAI

        client = AsyncAzureOpenAI(
            api_key=self.api_key,
            api_version="2024-02-01",
            azure_endpoint=self.endpoint
        )

        messages = [{"role": "user", "content": prompt}]
        kwargs = {
            "model": self.deployment,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens
        }

        if response_format == "json":
            kwargs["response_format"] = {"type": "json_object"}

        response = await client.chat.completions.create(**kwargs)

        return {
            "content": response.choices[0].message.content,
            "tokens_used": response.usage.total_tokens,
            "cost_usd": self._calculate_cost(response.usage)
        }
        ```
        """
        raise NotImplementedError("Implement Azure OpenAI integration")

    def get_provider_name(self) -> str:
        return "azure_openai"
