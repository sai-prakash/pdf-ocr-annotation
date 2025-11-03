# PromptForge Pipeline - Documentation Index

## 📚 Complete Documentation Guide

This is your starting point for the PromptForge Pipeline system. All documentation is organized below.

---

## 🚀 Getting Started

**Start here if this is your first time:**

1. **[README_PROMPTFORGE.md](README_PROMPTFORGE.md)** - Main overview and quick start
   - What you got
   - How to test (step-by-step)
   - What to expect
   - Next steps

2. **[TESTING_GUIDE.md](TESTING_GUIDE.md)** - Complete testing instructions
   - PostgreSQL installation
   - Database setup
   - Dependency installation
   - Running tests
   - Troubleshooting

3. **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Command cheat sheet
   - Common commands
   - API endpoints
   - Database queries
   - Keep this open while working!

---

## 📖 Detailed Documentation

### Architecture & Design

- **[PROMPTFORGE_SUMMARY.md](PROMPTFORGE_SUMMARY.md)** - Implementation details
  - All components delivered
  - Database schema
  - Architecture patterns
  - Performance characteristics

- **[ARCHITECTURE_DIAGRAM.md](ARCHITECTURE_DIAGRAM.md)** - Visual architecture
  - System overview diagram
  - Pipeline flow
  - Job state machine
  - Scaling characteristics

- **[pipeline_module.md](pipeline_module.md)** - Original specification
  - Requirements
  - Design decisions
  - Table schemas
  - API contracts

### Integration & Customization

- **[PROMPTFORGE_INTEGRATION.md](PROMPTFORGE_INTEGRATION.md)** - Integration guide
  - Plug-and-play architecture
  - Custom adapters
  - Custom stages
  - Production deployment

### Operations

- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common errors & solutions
  - Import errors
  - Database connection issues
  - Worker problems
  - Diagnostic tools

- **[FIXES_APPLIED.md](FIXES_APPLIED.md)** - Recent bug fixes
  - Import errors fixed
  - Schema issues resolved
  - Backward compatibility

---

## 📂 File Structure

### Core Implementation

```
backend/promptforge/
├── __init__.py               # Module entry point
├── cli.py                    # Setup CLI tool
├── adapters/                 # Plug-and-play providers
│   ├── base.py              # Abstract interfaces
│   ├── factory.py           # Provider factory
│   ├── storage_filesystem.py
│   ├── ocr_tesseract.py
│   └── llm_mock.py
├── api/                      # REST API
│   └── routes.py            # FastAPI endpoints
├── orchestrator/             # Core pipeline logic
│   ├── pipeline_manager.py  # Run lifecycle
│   ├── job_queue.py         # Job leasing
│   ├── dag_executor.py      # Stage execution
│   ├── retry_policy.py      # Error handling
│   └── idempotency.py       # Duplicate prevention
├── stages/                   # Processing stages
│   ├── upload_stage.py
│   ├── extract_stage.py
│   ├── classify_stage.py
│   ├── annotate_stage.py
│   └── registry.py
├── workers/                  # Job processors
│   └── loop.py
├── scheduler/                # Maintenance
│   └── watchdog.py
├── infra/                    # Infrastructure
│   ├── db.py                # Database pool
│   ├── settings.py          # Configuration
│   └── schema.sql           # Database schema
├── models/                   # Domain models
│   └── domain.py
└── config/                   # Configuration
    └── default_pipeline.json
```

### Supporting Files

```
backend/
├── main_with_pipeline.py     # Integrated FastAPI app
├── validate_installation.py  # Validation script
├── setup_pipeline.sh         # Setup script
├── requirements_pipeline.txt # Dependencies
├── Dockerfile               # Container image
├── .env.example             # Environment template
└── .gitignore               # Git ignore rules

root/
├── docker-compose.yml        # Docker orchestration
└── [All documentation files listed above]
```

---

## 🎯 Quick Navigation

### By Task

**I want to...**

- **Install and test** → [TESTING_GUIDE.md](TESTING_GUIDE.md)
- **Understand architecture** → [ARCHITECTURE_DIAGRAM.md](ARCHITECTURE_DIAGRAM.md)
- **Integrate into my app** → [PROMPTFORGE_INTEGRATION.md](PROMPTFORGE_INTEGRATION.md)
- **Fix an error** → [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **Find a command** → [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
- **See what was built** → [PROMPTFORGE_SUMMARY.md](PROMPTFORGE_SUMMARY.md)
- **Deploy to production** → [PROMPTFORGE_INTEGRATION.md](PROMPTFORGE_INTEGRATION.md) (Production Checklist)
- **Add custom logic** → [PROMPTFORGE_INTEGRATION.md](PROMPTFORGE_INTEGRATION.md) (Customization)

### By Role

**As a...**

- **Developer** → Start with [README_PROMPTFORGE.md](README_PROMPTFORGE.md)
- **DevOps Engineer** → See [TESTING_GUIDE.md](TESTING_GUIDE.md) + [docker-compose.yml](docker-compose.yml)
- **System Architect** → Read [ARCHITECTURE_DIAGRAM.md](ARCHITECTURE_DIAGRAM.md) + [PROMPTFORGE_SUMMARY.md](PROMPTFORGE_SUMMARY.md)
- **Database Admin** → Check [schema.sql](backend/promptforge/infra/schema.sql) + [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 🔍 Search Guide

### Common Questions

**Q: How do I set up the database?**
→ [TESTING_GUIDE.md](TESTING_GUIDE.md) - Step 2: Create Database

**Q: How do I fix "ModuleNotFoundError: No module named 'asyncpg'"?**
→ [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Error: ModuleNotFoundError

**Q: How do I add my Azure OpenAI integration?**
→ [PROMPTFORGE_INTEGRATION.md](PROMPTFORGE_INTEGRATION.md) - Add your Azure OpenAI

**Q: How do I scale workers?**
→ [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Performance Tuning

**Q: What tables are created?**
→ [PROMPTFORGE_SUMMARY.md](PROMPTFORGE_SUMMARY.md) - Database Schema

**Q: How does retry logic work?**
→ [ARCHITECTURE_DIAGRAM.md](ARCHITECTURE_DIAGRAM.md) - Error Categorization Flow

**Q: Can I use S3 instead of filesystem?**
→ [PROMPTFORGE_INTEGRATION.md](PROMPTFORGE_INTEGRATION.md) - Switch to S3

**Q: How do I monitor the pipeline?**
→ [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Monitoring

---

## 📈 Learning Path

### Beginner

1. Read [README_PROMPTFORGE.md](README_PROMPTFORGE.md) - Overview
2. Follow [TESTING_GUIDE.md](TESTING_GUIDE.md) - Set up and test
3. Use [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Common commands

### Intermediate

4. Study [ARCHITECTURE_DIAGRAM.md](ARCHITECTURE_DIAGRAM.md) - How it works
5. Review [PROMPTFORGE_SUMMARY.md](PROMPTFORGE_SUMMARY.md) - Implementation details
6. Try customizations from [PROMPTFORGE_INTEGRATION.md](PROMPTFORGE_INTEGRATION.md)

### Advanced

7. Read [pipeline_module.md](pipeline_module.md) - Original specification
8. Explore source code in `backend/promptforge/`
9. Implement custom stages and adapters
10. Deploy to production (checklist in [PROMPTFORGE_INTEGRATION.md](PROMPTFORGE_INTEGRATION.md))

---

## 🛠️ Essential Commands

```bash
# Setup (first time)
./backend/setup_pipeline.sh

# Validate installation
python backend/validate_installation.py

# Start services (Docker)
docker-compose up

# Start services (local)
python backend/main_with_pipeline.py          # Terminal 1
python -m promptforge.workers.loop            # Terminal 2
python -m promptforge.scheduler.watchdog      # Terminal 3

# Test
curl http://localhost:8000/api/v1/pipeline/health
```

---

## 📊 Documentation Status

| Document | Status | Last Updated |
|----------|--------|--------------|
| README_PROMPTFORGE.md | ✅ Complete | 2025-11-02 |
| TESTING_GUIDE.md | ✅ Complete | 2025-11-02 |
| QUICK_REFERENCE.md | ✅ Complete | 2025-11-02 |
| PROMPTFORGE_SUMMARY.md | ✅ Complete | 2025-11-02 |
| PROMPTFORGE_INTEGRATION.md | ✅ Complete | 2025-11-02 |
| ARCHITECTURE_DIAGRAM.md | ✅ Complete | 2025-11-02 |
| TROUBLESHOOTING.md | ✅ Complete | 2025-11-02 |
| FIXES_APPLIED.md | ✅ Complete | 2025-11-02 |
| pipeline_module.md | ✅ Original Spec | - |

---

## 🎊 Summary

You have **8 comprehensive documentation files** covering:
- ✅ Installation & setup
- ✅ Testing & validation
- ✅ Architecture & design
- ✅ Integration & customization
- ✅ Operations & monitoring
- ✅ Troubleshooting & fixes
- ✅ Quick reference commands

Plus **40+ implementation files** for a production-ready pipeline!

**Start here**: [README_PROMPTFORGE.md](README_PROMPTFORGE.md) → [TESTING_GUIDE.md](TESTING_GUIDE.md)

---

**Happy building! 🚀**

*Last updated: 2025-11-02*
