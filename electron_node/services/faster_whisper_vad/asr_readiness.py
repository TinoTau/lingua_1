"""ASR Worker readiness diagnostics (health / 503 reason helpers)."""
from __future__ import annotations

from typing import Any, Dict, Optional

from shared_types import WorkerState


def build_readiness_snapshot(
    *,
    manager_running: bool,
    worker_state: WorkerState,
    worker_process_alive: bool,
    queue_depth: int,
    queue_max: int,
    queue_full_flag: bool,
    last_error: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Compute readiness fields for GET /health diagnostics."""
    worker_running = (
        manager_running
        and worker_state == WorkerState.RUNNING
        and worker_process_alive
    )
    worker_restarting = worker_state in (WorkerState.RESTARTING, WorkerState.STARTING)
    queue_full = queue_full_flag or queue_depth >= queue_max
    worker_accepting_tasks = worker_running and not worker_restarting and not queue_full
    utterance_ready = worker_accepting_tasks

    return {
        "process_alive": manager_running,
        "worker_running": worker_running,
        "worker_accepting_tasks": worker_accepting_tasks,
        "queue_depth": queue_depth,
        "queue_max": queue_max,
        "queue_full": queue_full,
        "utterance_ready": utterance_ready,
        "worker_restarting": worker_restarting,
        "last_error": last_error,
    }
