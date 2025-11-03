"""
CLI for PromptForge setup and management
"""
import asyncio
import json
import logging
from pathlib import Path
import sys

from .infra.db import db
from .orchestrator.pipeline_manager import PipelineManager
from .models.domain import PipelineDefinition

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def init_database():
    """Initialize database schema"""
    logger.info("Initializing database schema...")

    try:
        await db.connect()
        await db.initialize_schema()
        logger.info("Database schema initialized successfully")
        return True
    except Exception as e:
        logger.error(f"Error initializing database: {e}")
        return False
    finally:
        await db.disconnect()


async def load_default_pipeline():
    """Load default pipeline configuration"""
    logger.info("Loading default pipeline configuration...")

    try:
        await db.connect()

        # Load default pipeline JSON
        config_path = Path(__file__).parent / "config" / "default_pipeline.json"

        if not config_path.exists():
            logger.error(f"Default pipeline config not found: {config_path}")
            return False

        with open(config_path, 'r') as f:
            config_data = json.load(f)

        pipeline_def = PipelineDefinition.from_dict(config_data)

        # Save to database
        manager = PipelineManager(db)
        config_id = await manager.save_pipeline_config(
            config=pipeline_def,
            project_id=None,  # Global config
            set_active=True
        )

        logger.info(f"Default pipeline loaded successfully (id={config_id})")
        return True

    except Exception as e:
        logger.error(f"Error loading default pipeline: {e}")
        return False
    finally:
        await db.disconnect()


async def setup():
    """Complete setup: initialize database and load default pipeline"""
    logger.info("Starting PromptForge setup...")

    # Initialize database
    if not await init_database():
        logger.error("Setup failed: could not initialize database")
        return False

    # Load default pipeline
    if not await load_default_pipeline():
        logger.error("Setup failed: could not load default pipeline")
        return False

    logger.info("Setup completed successfully!")
    return True


def main():
    """Main CLI entry point"""
    if len(sys.argv) < 2:
        print("Usage: python -m promptforge.cli <command>")
        print("\nCommands:")
        print("  setup          - Initialize database and load default pipeline")
        print("  init-db        - Initialize database schema only")
        print("  load-pipeline  - Load default pipeline configuration")
        sys.exit(1)

    command = sys.argv[1]

    if command == "setup":
        success = asyncio.run(setup())
    elif command == "init-db":
        success = asyncio.run(init_database())
    elif command == "load-pipeline":
        success = asyncio.run(load_default_pipeline())
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
