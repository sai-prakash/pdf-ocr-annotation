"""
Domain models for PromptForge Pipeline
"""
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
from datetime import datetime
from uuid import UUID
from enum import Enum


class JobStatus(str, Enum):
    """Job status states"""
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class RunStatus(str, Enum):
    """Pipeline run status states"""
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    PARTIAL = "partial"


class ErrorCategory(str, Enum):
    """Error categorization for retry logic"""
    TRANSIENT = "transient"    # Network, timeout → retry
    PERMANENT = "permanent"     # Bad file, parse error → DLQ immediately
    THROTTLE = "throttle"       # Rate limit → retry with longer backoff
    CONFIG = "config"           # Pipeline config error → alert


@dataclass
class Job:
    """Represents a single job in the queue"""
    id: int
    run_id: UUID
    project_id: Optional[UUID]
    doc_id: Optional[UUID]
    stage_key: str
    status: JobStatus
    attempts: int
    max_attempts: int
    not_before: datetime
    leased_by: Optional[str] = None
    leased_at: Optional[datetime] = None
    heartbeat_at: Optional[datetime] = None
    version: int = 1
    input_json: Dict[str, Any] = field(default_factory=dict)
    output_json: Dict[str, Any] = field(default_factory=dict)
    error_code: Optional[str] = None
    error_msg: Optional[str] = None
    error_category: Optional[ErrorCategory] = None
    llm_tokens_used: Optional[int] = None
    llm_cost_usd: Optional[float] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class PipelineRun:
    """Represents a pipeline run"""
    id: UUID
    project_id: Optional[UUID]
    pipeline_config_version: str
    pipeline_config_snapshot: Dict[str, Any]
    status: RunStatus
    total_jobs: int = 0
    completed_jobs: int = 0
    failed_jobs: int = 0
    started_at: datetime = field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class PipelineConfig:
    """Pipeline configuration"""
    id: int
    project_id: Optional[UUID]
    version: str
    config_json: Dict[str, Any]
    is_active: bool = False
    created_by: Optional[UUID] = None
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class StageResult:
    """Result of a stage execution"""
    success: bool
    output: Dict[str, Any]
    error: Optional[Exception] = None
    tokens_used: Optional[int] = None
    cost_usd: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "success": self.success,
            "output": self.output,
            "error": str(self.error) if self.error else None,
            "tokens_used": self.tokens_used,
            "cost_usd": self.cost_usd
        }


@dataclass
class StageConfig:
    """Configuration for a single stage"""
    key: str
    next_stages: List[str] = field(default_factory=list)
    timeout_seconds: int = 300
    max_retries: int = 3
    wait_for_all: bool = False  # For DAG: wait for all parent stages
    config: Dict[str, Any] = field(default_factory=dict)  # Stage-specific config


@dataclass
class PipelineDefinition:
    """Complete pipeline definition"""
    name: str
    version: str
    type: str  # "linear" or "dag"
    entry_stage: str
    stages: Dict[str, StageConfig]
    limits: Dict[str, Any] = field(default_factory=dict)
    policy: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'PipelineDefinition':
        """Create from dictionary"""
        stages = {}
        for key, stage_data in data.get("stages", {}).items():
            stages[key] = StageConfig(
                key=key,
                next_stages=stage_data.get("next", []),
                timeout_seconds=stage_data.get("timeout_seconds", 300),
                max_retries=stage_data.get("max_retries", 3),
                wait_for_all=stage_data.get("wait_for_all", False),
                config=stage_data.get("config", {})
            )

        return cls(
            name=data["name"],
            version=data["version"],
            type=data.get("type", "linear"),
            entry_stage=data["entry_stage"],
            stages=stages,
            limits=data.get("limits", {}),
            policy=data.get("policy", {})
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "name": self.name,
            "version": self.version,
            "type": self.type,
            "entry_stage": self.entry_stage,
            "stages": {
                key: {
                    "next": stage.next_stages,
                    "timeout_seconds": stage.timeout_seconds,
                    "max_retries": stage.max_retries,
                    "wait_for_all": stage.wait_for_all,
                    "config": stage.config
                }
                for key, stage in self.stages.items()
            },
            "limits": self.limits,
            "policy": self.policy
        }
