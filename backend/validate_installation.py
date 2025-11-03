#!/usr/bin/env python3
"""
Validation script for PromptForge Pipeline installation
Run this to check if everything is set up correctly
"""
import sys
import asyncio
from pathlib import Path

# Colors for terminal output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'


def print_header(text):
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}{text.center(60)}{RESET}")
    print(f"{BLUE}{'='*60}{RESET}\n")


def print_success(text):
    print(f"{GREEN}✓{RESET} {text}")


def print_error(text):
    print(f"{RED}✗{RESET} {text}")


def print_warning(text):
    print(f"{YELLOW}⚠{RESET} {text}")


def print_info(text):
    print(f"{BLUE}ℹ{RESET} {text}")


async def check_python_version():
    """Check Python version"""
    print_info("Checking Python version...")
    version = sys.version_info
    if version.major == 3 and version.minor >= 9:
        print_success(f"Python {version.major}.{version.minor}.{version.micro}")
        return True
    else:
        print_error(f"Python {version.major}.{version.minor} - Requires Python 3.9+")
        return False


async def check_dependencies():
    """Check if required packages are installed"""
    print_info("Checking Python dependencies...")

    required = [
        'fastapi',
        'uvicorn',
        'asyncpg',
        'pydantic',
        'pydantic_settings'
    ]

    all_installed = True
    for package in required:
        try:
            __import__(package.replace('-', '_'))
            print_success(f"{package} installed")
        except ImportError:
            print_error(f"{package} not installed")
            all_installed = False

    return all_installed


async def check_database_connection():
    """Check database connection"""
    print_info("Checking database connection...")

    try:
        from promptforge.infra.db import db
        from promptforge.infra.settings import settings

        print_info(f"Database URL: {settings.DATABASE_URL.split('@')[0]}@***")

        await db.connect()
        result = await db.fetchval("SELECT 1")

        if result == 1:
            print_success("Database connection successful")
            await db.disconnect()
            return True
        else:
            print_error("Database connection failed")
            return False

    except Exception as e:
        print_error(f"Database connection failed: {str(e)}")
        return False


async def check_database_schema():
    """Check if database schema is initialized"""
    print_info("Checking database schema...")

    try:
        from promptforge.infra.db import db

        await db.connect()

        # Check for required tables
        tables = await db.fetch("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name LIKE 'pf_%'
            ORDER BY table_name
        """)

        table_names = [t['table_name'] for t in tables]

        required_tables = [
            'pf_pipeline_configs',
            'pf_runs',
            'pf_jobs',
            'pf_jobs_dlq',
            'pf_idem',
            'pf_jobs_archive'
        ]

        all_present = True
        for table in required_tables:
            if table in table_names:
                print_success(f"Table {table} exists")
            else:
                print_error(f"Table {table} missing")
                all_present = False

        await db.disconnect()
        return all_present

    except Exception as e:
        print_error(f"Schema check failed: {str(e)}")
        return False


async def check_pipeline_config():
    """Check if default pipeline config is loaded"""
    print_info("Checking pipeline configuration...")

    try:
        from promptforge.infra.db import db

        await db.connect()

        config = await db.fetchrow("""
            SELECT id, version, is_active FROM pf_pipeline_configs
            WHERE is_active = TRUE
            LIMIT 1
        """)

        if config:
            print_success(f"Active pipeline config found (version {config['version']})")
            await db.disconnect()
            return True
        else:
            print_warning("No active pipeline configuration found")
            print_info("Run: python -m promptforge.cli load-pipeline")
            await db.disconnect()
            return False

    except Exception as e:
        print_error(f"Config check failed: {str(e)}")
        return False


async def check_storage_directory():
    """Check if storage directory exists"""
    print_info("Checking storage directory...")

    try:
        from promptforge.infra.settings import settings

        storage_path = Path(settings.STORAGE_BASE_PATH)

        if storage_path.exists():
            print_success(f"Storage directory exists: {storage_path}")
            return True
        else:
            print_warning(f"Storage directory not found: {storage_path}")
            print_info("Creating storage directory...")
            storage_path.mkdir(parents=True, exist_ok=True)
            print_success("Storage directory created")
            return True

    except Exception as e:
        print_error(f"Storage check failed: {str(e)}")
        return False


async def check_adapters():
    """Check if adapters can be initialized"""
    print_info("Checking adapters...")

    try:
        from promptforge.adapters.factory import AdapterFactory

        # Try to get storage adapter
        storage = AdapterFactory.get_storage_adapter()
        print_success(f"Storage adapter: {type(storage).__name__}")

        # Try to get OCR adapter
        ocr = AdapterFactory.get_ocr_adapter()
        print_success(f"OCR adapter: {type(ocr).__name__}")

        # Try to get LLM adapter
        llm = AdapterFactory.get_llm_adapter()
        print_success(f"LLM adapter: {type(llm).__name__}")

        return True

    except Exception as e:
        print_error(f"Adapter initialization failed: {str(e)}")
        return False


async def check_stage_registry():
    """Check if stages are registered"""
    print_info("Checking stage registry...")

    try:
        from promptforge.stages.registry import get_stage_registry

        registry = get_stage_registry()
        stages = registry.list_stages()

        expected_stages = ['upload', 'extract_text', 'classify_doc', 'auto_annotate']

        all_present = True
        for stage in expected_stages:
            if stage in stages:
                print_success(f"Stage '{stage}' registered")
            else:
                print_error(f"Stage '{stage}' not registered")
                all_present = False

        return all_present

    except Exception as e:
        print_error(f"Stage registry check failed: {str(e)}")
        return False


async def main():
    """Run all validation checks"""
    print_header("PromptForge Pipeline - Installation Validation")

    checks = [
        ("Python Version", check_python_version),
        ("Python Dependencies", check_dependencies),
        ("Database Connection", check_database_connection),
        ("Database Schema", check_database_schema),
        ("Pipeline Configuration", check_pipeline_config),
        ("Storage Directory", check_storage_directory),
        ("Adapters", check_adapters),
        ("Stage Registry", check_stage_registry),
    ]

    results = {}

    for name, check_func in checks:
        print_header(name)
        try:
            results[name] = await check_func()
        except Exception as e:
            print_error(f"Unexpected error: {str(e)}")
            results[name] = False

    # Summary
    print_header("Validation Summary")

    passed = sum(1 for v in results.values() if v)
    total = len(results)

    for name, result in results.items():
        status = f"{GREEN}PASS{RESET}" if result else f"{RED}FAIL{RESET}"
        print(f"{status} - {name}")

    print(f"\n{BLUE}Results: {passed}/{total} checks passed{RESET}\n")

    if passed == total:
        print_success("All checks passed! ✨")
        print_info("\nNext steps:")
        print_info("  1. Start API server: python main_with_pipeline.py")
        print_info("  2. Start worker: python -m promptforge.workers.loop")
        print_info("  3. Start scheduler: python -m promptforge.scheduler.watchdog")
        print_info("\nOr use Docker: docker-compose up")
        return 0
    else:
        print_error("Some checks failed. Please fix the issues above.")
        print_info("\nCommon fixes:")
        print_info("  - Install dependencies: pip install -r requirements_pipeline.txt")
        print_info("  - Initialize database: python -m promptforge.cli setup")
        print_info("  - Check .env file has correct DATABASE_URL")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
