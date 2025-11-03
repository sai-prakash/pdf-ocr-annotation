"""
Idempotency cache to prevent duplicate processing
"""
import hashlib
import json
from typing import Dict, Any, Optional
from uuid import UUID
import logging

logger = logging.getLogger(__name__)


class IdempotencyCache:
    """Prevents duplicate processing of identical inputs"""

    def __init__(self, db):
        self.db = db

    @staticmethod
    def compute_hash(input_json: Dict[str, Any]) -> str:
        """
        Compute deterministic hash of input

        Args:
            input_json: Input dictionary to hash

        Returns:
            SHA256 hash string
        """
        # Create canonical JSON representation (sorted keys, consistent encoding)
        canonical = json.dumps(input_json, sort_keys=True, ensure_ascii=True)
        return hashlib.sha256(canonical.encode()).hexdigest()

    async def check(
        self,
        run_id: UUID,
        stage_key: str,
        input_json: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Check if this input was already processed

        Args:
            run_id: Pipeline run ID
            stage_key: Stage identifier
            input_json: Input data dictionary

        Returns:
            Cached output if found, None otherwise
        """
        input_hash = self.compute_hash(input_json)

        row = await self.db.fetchrow("""
            SELECT output_json
            FROM pf_idem
            WHERE run_id = $1 AND stage_key = $2 AND input_hash = $3
              AND expires_at > NOW()
        """, run_id, stage_key, input_hash)

        if row:
            logger.info(f"Idempotency cache HIT for run={run_id}, stage={stage_key}")
            return json.loads(row["output_json"]) if row["output_json"] else None

        logger.debug(f"Idempotency cache MISS for run={run_id}, stage={stage_key}")
        return None

    async def store(
        self,
        run_id: UUID,
        stage_key: str,
        input_json: Dict[str, Any],
        output_json: Dict[str, Any]
    ):
        """
        Store successful result for future idempotency checks

        Args:
            run_id: Pipeline run ID
            stage_key: Stage identifier
            input_json: Input data dictionary
            output_json: Output data dictionary
        """
        input_hash = self.compute_hash(input_json)

        await self.db.execute("""
            INSERT INTO pf_idem (run_id, stage_key, input_hash, output_json)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (run_id, stage_key, input_hash) DO UPDATE
            SET output_json = EXCLUDED.output_json,
                processed_at = NOW(),
                expires_at = NOW() + INTERVAL '7 days'
        """, run_id, stage_key, input_hash, json.dumps(output_json))

        logger.debug(f"Stored idempotency cache for run={run_id}, stage={stage_key}")

    async def clear_expired(self) -> int:
        """
        Remove expired idempotency entries

        Returns:
            Number of entries deleted
        """
        result = await self.db.execute("""
            DELETE FROM pf_idem
            WHERE expires_at < NOW()
        """)

        # Parse result like "DELETE 5"
        count = int(result.split()[-1]) if result else 0
        if count > 0:
            logger.info(f"Cleared {count} expired idempotency cache entries")

        return count
