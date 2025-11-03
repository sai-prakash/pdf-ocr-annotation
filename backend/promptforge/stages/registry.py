"""
Stage registry for managing and instantiating pipeline stages
"""
from typing import Dict, Optional
import logging
from .base import BaseStage
from .upload_stage import UploadStage
from .extract_stage import ExtractTextStage
from .classify_stage import ClassifyDocStage
from .annotate_stage import AutoAnnotateStage

logger = logging.getLogger(__name__)


class StageRegistry:
    """
    Registry for pipeline stages

    Provides a factory pattern for creating and managing stage instances
    """

    def __init__(self):
        self._stages: Dict[str, BaseStage] = {}
        self._register_default_stages()

    def _register_default_stages(self):
        """Register all built-in stages"""
        default_stages = [
            UploadStage(),
            ExtractTextStage(),
            ClassifyDocStage(),
            AutoAnnotateStage()
        ]

        for stage in default_stages:
            self.register_stage(stage)

    def register_stage(self, stage: BaseStage):
        """
        Register a stage instance

        Args:
            stage: Stage instance to register
        """
        stage_key = stage.get_stage_key()
        self._stages[stage_key] = stage
        logger.info(f"Registered stage: {stage_key}")

    def get_stage(self, stage_key: str) -> BaseStage:
        """
        Get stage instance by key

        Args:
            stage_key: Stage identifier

        Returns:
            Stage instance

        Raises:
            ValueError: If stage not found
        """
        if stage_key not in self._stages:
            raise ValueError(f"Stage not found: {stage_key}")

        return self._stages[stage_key]

    def has_stage(self, stage_key: str) -> bool:
        """
        Check if stage is registered

        Args:
            stage_key: Stage identifier

        Returns:
            True if stage is registered
        """
        return stage_key in self._stages

    def list_stages(self) -> list:
        """
        List all registered stage keys

        Returns:
            List of stage keys
        """
        return list(self._stages.keys())

    def unregister_stage(self, stage_key: str):
        """
        Remove a stage from registry

        Args:
            stage_key: Stage identifier
        """
        if stage_key in self._stages:
            del self._stages[stage_key]
            logger.info(f"Unregistered stage: {stage_key}")


# Global registry instance
_default_registry: Optional[StageRegistry] = None


def get_stage_registry() -> StageRegistry:
    """
    Get the global stage registry instance

    Returns:
        StageRegistry instance
    """
    global _default_registry

    if _default_registry is None:
        _default_registry = StageRegistry()

    return _default_registry
