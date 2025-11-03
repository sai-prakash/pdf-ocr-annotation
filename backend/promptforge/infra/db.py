"""
Database connection management for PromptForge
"""
import asyncpg
from typing import Optional, Any, Dict, List
from contextlib import asynccontextmanager
import logging
from .settings import settings

logger = logging.getLogger(__name__)


class DatabaseManager:
    """
    Async database connection manager using asyncpg
    Provides connection pooling and query execution methods
    """

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or settings.DATABASE_URL
        self.pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        """Initialize connection pool"""
        if self.pool is None:
            # Parse database URL for asyncpg
            # Convert from postgresql+asyncpg:// to postgresql://
            db_url = self.database_url.replace("postgresql+asyncpg://", "postgresql://")

            logger.info(f"Connecting to database...")
            self.pool = await asyncpg.create_pool(
                db_url,
                min_size=2,
                max_size=settings.DB_POOL_SIZE,
                max_inactive_connection_lifetime=300,
                command_timeout=60
            )
            logger.info("Database connection pool created")

    async def disconnect(self):
        """Close connection pool"""
        if self.pool:
            await self.pool.close()
            self.pool = None
            logger.info("Database connection pool closed")

    @asynccontextmanager
    async def transaction(self):
        """Context manager for transactions"""
        if not self.pool:
            await self.connect()

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                yield conn

    async def execute(self, query: str, *args) -> str:
        """Execute a query (INSERT, UPDATE, DELETE)"""
        if not self.pool:
            await self.connect()

        async with self.pool.acquire() as conn:
            return await conn.execute(query, *args)

    async def fetch(self, query: str, *args) -> List[asyncpg.Record]:
        """Fetch multiple rows"""
        if not self.pool:
            await self.connect()

        async with self.pool.acquire() as conn:
            return await conn.fetch(query, *args)

    async def fetchrow(self, query: str, *args) -> Optional[asyncpg.Record]:
        """Fetch a single row"""
        if not self.pool:
            await self.connect()

        async with self.pool.acquire() as conn:
            return await conn.fetchrow(query, *args)

    async def fetchval(self, query: str, *args) -> Any:
        """Fetch a single value"""
        if not self.pool:
            await self.connect()

        async with self.pool.acquire() as conn:
            return await conn.fetchval(query, *args)

    async def executemany(self, query: str, args_list: List[tuple]):
        """Execute query with multiple parameter sets"""
        if not self.pool:
            await self.connect()

        async with self.pool.acquire() as conn:
            await conn.executemany(query, args_list)

    async def initialize_schema(self, schema_file: str = None):
        """Initialize database schema from SQL file"""
        if schema_file is None:
            import os
            schema_file = os.path.join(
                os.path.dirname(__file__),
                "schema.sql"
            )

        logger.info(f"Initializing database schema from {schema_file}")

        with open(schema_file, 'r') as f:
            schema_sql = f.read()

        if not self.pool:
            await self.connect()

        async with self.pool.acquire() as conn:
            await conn.execute(schema_sql)

        logger.info("Database schema initialized successfully")


# Global database instance
db = DatabaseManager()


async def get_db() -> DatabaseManager:
    """Dependency for FastAPI endpoints"""
    if not db.pool:
        await db.connect()
    return db
