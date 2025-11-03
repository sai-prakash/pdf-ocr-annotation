"""
Base stage class for pipeline stages
"""
from abc import ABC, abstractmethod
from typing import Dict, Any
from ..models.domain import StageResult
import logging

logger = logging.getLogger(__name__)


class BaseStage(ABC):
    """Abstract base class for all pipeline stages"""

    @abstractmethod
    async def execute(self, input_data: Dict[str, Any]) -> StageResult:
        """
        Execute the stage logic

        Args:
            input_data: Input dictionary containing all necessary data

        Returns:
            StageResult with success status and output data
        """
        pass

    @abstractmethod
    def get_stage_key(self) -> str:
        """
        Return unique stage identifier

        Returns:
            Stage key (e.g., "upload", "extract_text")
        """
        pass

    def get_timeout_seconds(self) -> int:
        """
        Override to set custom timeout

        Returns:
            Timeout in seconds (default: 300 = 5 minutes)
        """
        return 300

    async def _handle_error(self, error: Exception) -> StageResult:
        """
        Handle errors and return failed StageResult

        Args:
            error: Exception that occurred

        Returns:
            StageResult with success=False
        """
        logger.error(f"Stage {self.get_stage_key()} failed: {error}", exc_info=True)
        return StageResult(
            success=False,
            output={},
            error=error
        )
