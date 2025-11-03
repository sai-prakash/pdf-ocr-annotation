-- ============================================================================
-- PromptForge Pipeline Infrastructure - Database Schema
-- Version: 1.0.0
-- ============================================================================

-- ============================================================================
-- Pipeline Configurations
-- ============================================================================
CREATE TABLE IF NOT EXISTS pf_pipeline_configs (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID,  -- NULL for global configs, specific for project-level
  version TEXT NOT NULL,
  config_json JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_configs_active
  ON pf_pipeline_configs(project_id, is_active)
  WHERE is_active = TRUE;

-- ============================================================================
-- Pipeline Runs
-- ============================================================================
CREATE TABLE IF NOT EXISTS pf_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID,  -- Reference to projects(id)
  pipeline_config_version TEXT NOT NULL,
  pipeline_config_snapshot JSONB NOT NULL,  -- Immutable config copy
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'done', 'failed', 'partial')),
  total_jobs INT DEFAULT 0,
  completed_jobs INT DEFAULT 0,
  failed_jobs INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_project ON pf_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON pf_runs(status, started_at) WHERE status = 'running';

-- ============================================================================
-- Jobs Queue (Heart of the System)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pf_jobs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES pf_runs(id) ON DELETE CASCADE,
  project_id UUID,  -- Reference to projects(id)
  doc_id UUID,  -- Reference to documents(id)
  stage_key TEXT NOT NULL,

  -- Job State
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  not_before TIMESTAMPTZ DEFAULT NOW(),  -- For exponential backoff

  -- Lease Management (for distributed workers)
  leased_by TEXT,          -- Worker ID
  leased_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  version INT DEFAULT 1,   -- For optimistic locking

  -- Input/Output
  input_json JSONB,
  output_json JSONB,

  -- Error Tracking
  error_code TEXT,
  error_msg TEXT,
  error_category TEXT
    CHECK (error_category IN ('transient', 'permanent', 'throttle', 'config')),

  -- Cost Tracking (LLM usage)
  llm_tokens_used INT,
  llm_cost_usd DECIMAL(10, 4),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate jobs for same run+doc+stage
  CONSTRAINT uniq_job_per_stage UNIQUE(run_id, doc_id, stage_key)
);

-- ============================================================================
-- CRITICAL INDEXES (Required for Performance)
-- ============================================================================

-- Queue scanning (workers lease next job)
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON pf_jobs(not_before, id)
  WHERE status = 'queued';

-- Watchdog queries (find stale jobs)
CREATE INDEX IF NOT EXISTS idx_jobs_heartbeat ON pf_jobs(status, heartbeat_at)
  WHERE status = 'running';

-- Foreign key lookups
CREATE INDEX IF NOT EXISTS idx_jobs_run_id ON pf_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_jobs_doc_id ON pf_jobs(doc_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project_id ON pf_jobs(project_id);

-- Status monitoring
CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON pf_jobs(status, updated_at);

-- ============================================================================
-- Dead Letter Queue
-- ============================================================================
CREATE TABLE IF NOT EXISTS pf_jobs_dlq (
  LIKE pf_jobs INCLUDING ALL,
  moved_to_dlq_at TIMESTAMPTZ DEFAULT NOW(),
  original_job_id BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dlq_moved_at ON pf_jobs_dlq(moved_to_dlq_at DESC);

-- ============================================================================
-- Idempotency Cache
-- ============================================================================
CREATE TABLE IF NOT EXISTS pf_idem (
  run_id UUID NOT NULL,
  stage_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_json JSONB,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  PRIMARY KEY (run_id, stage_key, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_idem_expiry ON pf_idem(expires_at);

-- ============================================================================
-- Archive Table (for old completed jobs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pf_jobs_archive (
  LIKE pf_jobs INCLUDING ALL,
  archived_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archive_created ON pf_jobs_archive(created_at DESC);

-- ============================================================================
-- Update existing documents table to add pipeline fields (if table exists)
-- ============================================================================
DO $$
BEGIN
  -- Only proceed if documents table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'documents'
  ) THEN
    -- Add ocr_json_s3_key column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'ocr_json_s3_key'
    ) THEN
      ALTER TABLE documents ADD COLUMN ocr_json_s3_key TEXT;
    END IF;

    -- Add annotations_json_s3_key column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'annotations_json_s3_key'
    ) THEN
      ALTER TABLE documents ADD COLUMN annotations_json_s3_key TEXT;
    END IF;

    -- Add doc_type column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'doc_type'
    ) THEN
      ALTER TABLE documents ADD COLUMN doc_type TEXT;
    END IF;

    -- Add status column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'status'
    ) THEN
      ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'pending';
    END IF;

    -- Add pipeline_run_id column to track which pipeline run processed this document
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'pipeline_run_id'
    ) THEN
      ALTER TABLE documents ADD COLUMN pipeline_run_id UUID REFERENCES pf_runs(id);
    END IF;

    RAISE NOTICE 'Updated documents table with pipeline fields';
  ELSE
    RAISE NOTICE 'documents table does not exist - skipping migration (this is OK for new installations)';
  END IF;
END $$;

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for pf_jobs
DROP TRIGGER IF EXISTS update_pf_jobs_updated_at ON pf_jobs;
CREATE TRIGGER update_pf_jobs_updated_at
    BEFORE UPDATE ON pf_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE pf_pipeline_configs IS 'Stores pipeline configuration (DAG definitions, stage settings)';
COMMENT ON TABLE pf_runs IS 'Tracks pipeline run lifecycle and aggregates job statistics';
COMMENT ON TABLE pf_jobs IS 'Main job queue - core of the orchestration system';
COMMENT ON TABLE pf_jobs_dlq IS 'Dead letter queue for permanently failed jobs';
COMMENT ON TABLE pf_idem IS 'Idempotency cache to prevent duplicate processing';
COMMENT ON TABLE pf_jobs_archive IS 'Archive for old completed/failed jobs (retention management)';
