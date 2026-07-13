"""Structured ASR HTTP errors for /utterance (machine-readable reason)."""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException


def asr_service_unavailable(
    reason: str,
    message: str,
    *,
    status_code: int = 503,
    retry_after: str = "1",
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"message": message, "reason": reason},
        headers={"Retry-After": retry_after},
    )


def queue_full_error() -> HTTPException:
    return asr_service_unavailable(
        "queue_full",
        "ASR service is busy, please retry later",
    )


def worker_not_ready_error(message: Optional[str] = None) -> HTTPException:
    return asr_service_unavailable(
        "worker_not_ready",
        message or "ASR service is temporarily unavailable, please retry later",
        retry_after="2",
    )


def worker_restarting_error() -> HTTPException:
    return asr_service_unavailable(
        "worker_restarting",
        "ASR worker is restarting, please retry later",
        retry_after="2",
    )


def timeout_recovery_error(max_wait_seconds: float) -> HTTPException:
    return HTTPException(
        status_code=504,
        detail={
            "message": f"ASR processing timeout after {max_wait_seconds}s",
            "reason": "timeout_recovery",
        },
    )
