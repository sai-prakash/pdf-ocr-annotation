"""
Retry policy for error categorization and backoff calculation
"""
import asyncio
import random
from typing import Tuple
from ..models.domain import ErrorCategory
import logging

logger = logging.getLogger(__name__)


class RetryPolicy:
    """Determines retry behavior based on error type"""

    @staticmethod
    def categorize_error(error: Exception) -> ErrorCategory:
        """Classify error into retry category"""
        error_str = str(error).lower()
        error_type = type(error).__name__

        # Transient errors (network, timeout)
        if isinstance(error, (TimeoutError, asyncio.TimeoutError, ConnectionError)):
            return ErrorCategory.TRANSIENT

        if "timeout" in error_str or "connection" in error_str:
            return ErrorCategory.TRANSIENT

        if "network" in error_str or "socket" in error_str:
            return ErrorCategory.TRANSIENT

        # Throttling errors (rate limits)
        if "429" in error_str or "rate limit" in error_str:
            return ErrorCategory.THROTTLE

        if "throttle" in error_str or "too many requests" in error_str:
            return ErrorCategory.THROTTLE

        if "quota" in error_str or "limit exceeded" in error_str:
            return ErrorCategory.THROTTLE

        # Permanent errors (corrupted files, validation errors)
        permanent_keywords = [
            "corrupt", "invalid", "malformed", "parse error",
            "decode error", "bad format", "unsupported"
        ]
        if any(keyword in error_str for keyword in permanent_keywords):
            return ErrorCategory.PERMANENT

        # Config errors
        if "config" in error_str or "configuration" in error_str:
            return ErrorCategory.CONFIG

        if error_type in ["ValueError", "KeyError", "AttributeError"]:
            # These might be config issues
            return ErrorCategory.CONFIG

        # Default: treat as transient (conservative approach)
        logger.warning(f"Unknown error type '{error_type}': {error_str[:100]}. Treating as TRANSIENT")
        return ErrorCategory.TRANSIENT

    @staticmethod
    def should_retry(error_category: ErrorCategory, attempts: int, max_attempts: int) -> bool:
        """Determine if job should be retried"""

        # Never retry permanent or config errors
        if error_category in [ErrorCategory.PERMANENT, ErrorCategory.CONFIG]:
            return False

        # Retry if we haven't hit max attempts
        return attempts < max_attempts

    @staticmethod
    def compute_backoff(attempts: int, error_category: ErrorCategory) -> Tuple[int, str]:
        """
        Compute backoff delay in seconds with jitter
        Returns: (backoff_seconds, reason)
        """

        if error_category == ErrorCategory.THROTTLE:
            # Longer backoff for rate limits
            base = min(2 ** attempts, 120)  # Max 2 minutes
            reason = "throttle_backoff"
        else:
            # Standard exponential backoff
            base = min(2 ** attempts, 60)   # Max 1 minute
            reason = "transient_backoff"

        # Add jitter (0-1 second)
        jitter = random.uniform(0, 1)
        backoff_seconds = int(base + jitter)

        logger.info(f"Computed backoff: {backoff_seconds}s for attempt {attempts} ({error_category.value})")

        return backoff_seconds, reason


# Convenience function for error handling in stages
async def with_retry(
    func,
    max_retries: int = 3,
    backoff_base: int = 2,
    *args,
    **kwargs
):
    """
    Execute a function with retry logic

    Args:
        func: Async function to execute
        max_retries: Maximum number of retry attempts
        backoff_base: Base for exponential backoff
        *args, **kwargs: Arguments to pass to func

    Returns:
        Result of func

    Raises:
        Last exception if all retries fail
    """
    last_error = None

    for attempt in range(max_retries + 1):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            last_error = e
            category = RetryPolicy.categorize_error(e)

            if not RetryPolicy.should_retry(category, attempt, max_retries):
                logger.error(f"Non-retryable error ({category.value}): {e}")
                raise

            if attempt < max_retries:
                backoff, _ = RetryPolicy.compute_backoff(attempt, category)
                logger.warning(f"Attempt {attempt + 1}/{max_retries} failed: {e}. Retrying in {backoff}s")
                await asyncio.sleep(backoff)
            else:
                logger.error(f"All {max_retries} retries exhausted: {e}")
                raise

    raise last_error
