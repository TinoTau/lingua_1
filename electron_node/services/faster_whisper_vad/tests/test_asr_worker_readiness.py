"""Tests for ASR worker readiness, queue recovery, and 503 reason contract."""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shared_types import WorkerState  # noqa: E402
from asr_readiness import build_readiness_snapshot  # noqa: E402
from asr_errors import (  # noqa: E402
    queue_full_error,
    worker_not_ready_error,
    worker_restarting_error,
    timeout_recovery_error,
)
from asr_worker_manager import ASRWorkerManager, QUEUE_MAX  # noqa: E402


class ReadinessSnapshotTest(unittest.TestCase):
    def test_queue_empty_worker_running(self):
        snap = build_readiness_snapshot(
            manager_running=True,
            worker_state=WorkerState.RUNNING,
            worker_process_alive=True,
            queue_depth=0,
            queue_max=QUEUE_MAX,
            queue_full_flag=False,
            last_error=None,
        )
        self.assertTrue(snap["utterance_ready"])
        self.assertFalse(snap["queue_full"])
        self.assertTrue(snap["worker_accepting_tasks"])

    def test_queue_at_max_not_ready(self):
        snap = build_readiness_snapshot(
            manager_running=True,
            worker_state=WorkerState.RUNNING,
            worker_process_alive=True,
            queue_depth=QUEUE_MAX,
            queue_max=QUEUE_MAX,
            queue_full_flag=True,
            last_error=None,
        )
        self.assertFalse(snap["utterance_ready"])
        self.assertTrue(snap["queue_full"])
        self.assertFalse(snap["worker_accepting_tasks"])

    def test_worker_not_running(self):
        snap = build_readiness_snapshot(
            manager_running=True,
            worker_state=WorkerState.CRASHED,
            worker_process_alive=False,
            queue_depth=0,
            queue_max=QUEUE_MAX,
            queue_full_flag=False,
            last_error={"reason": "task_timeout"},
        )
        self.assertFalse(snap["utterance_ready"])
        self.assertFalse(snap["worker_running"])
        self.assertEqual(snap["last_error"]["reason"], "task_timeout")

    def test_worker_restarting(self):
        snap = build_readiness_snapshot(
            manager_running=True,
            worker_state=WorkerState.RESTARTING,
            worker_process_alive=True,
            queue_depth=0,
            queue_max=QUEUE_MAX,
            queue_full_flag=False,
            last_error=None,
        )
        self.assertFalse(snap["utterance_ready"])
        self.assertTrue(snap["worker_restarting"])


class ManagerReadinessTest(unittest.TestCase):
    def _manager(self) -> ASRWorkerManager:
        mgr = ASRWorkerManager(queue_max=1)
        mgr.is_running = True
        mgr._state = WorkerState.RUNNING
        mgr.worker_process = MagicMock()
        mgr.worker_process.is_alive.return_value = True
        mgr.task_queue = MagicMock()
        mgr.task_queue.qsize.return_value = 0
        mgr.task_queue.full.return_value = False
        return mgr

    def test_get_readiness_reflects_queue_full(self):
        mgr = self._manager()
        mgr.task_queue.qsize.return_value = 1
        mgr.task_queue.full.return_value = True
        snap = mgr.get_readiness()
        self.assertFalse(snap["utterance_ready"])
        self.assertTrue(snap["queue_full"])


class QueueTimeoutRecoveryTest(unittest.IsolatedAsyncioTestCase):
    async def test_timeout_triggers_recovery(self):
        mgr = ASRWorkerManager(queue_max=1)
        mgr.is_running = True
        mgr._state = WorkerState.RUNNING
        mgr.worker_process = MagicMock()
        mgr.worker_process.is_alive.return_value = True
        mgr.task_queue = MagicMock()
        mgr.task_queue.full.return_value = False
        mgr.task_queue.put = MagicMock()

        loop = asyncio.get_running_loop()
        pending = loop.create_future()
        mgr.pending_results["job-x"] = pending

        mgr._recover_worker = AsyncMock()

        async def fake_put(_):
            return None

        mgr.task_queue.put = fake_put

        with patch.object(mgr, "pending_results", {"t_1": pending}):
            with patch("asyncio.wait_for", side_effect=asyncio.TimeoutError):
                audio = __import__("numpy").zeros(1600, dtype=__import__("numpy").float32)
                with self.assertRaises(asyncio.TimeoutError):
                    await mgr.submit_task(
                        audio=audio,
                        sample_rate=16000,
                        language="zh",
                        task="transcribe",
                        beam_size=1,
                        initial_prompt=None,
                        condition_on_previous_text=False,
                        trace_id="timeout-test",
                        max_wait=0.01,
                    )

        mgr._recover_worker.assert_awaited_once()
        call_args = mgr._recover_worker.await_args
        self.assertEqual(call_args[0][0], "task_timeout")
        self.assertEqual(call_args[0][1], "timeout-test")
        self.assertNotIn("t_1", mgr.pending_results)

    async def test_wait_until_accepting_after_restart(self):
        mgr = ASRWorkerManager(queue_max=1)
        mgr.is_running = True
        mgr._state = WorkerState.RESTARTING
        mgr.task_queue = MagicMock()
        mgr.task_queue.full.return_value = False

        async def flip_running():
            await asyncio.sleep(0.3)
            mgr._state = WorkerState.RUNNING

        asyncio.create_task(flip_running())
        ok = await mgr.wait_until_accepting(max_wait=2.0)
        self.assertTrue(ok)


class Asr503ReasonTest(unittest.TestCase):
    def test_queue_full_reason(self):
        exc = queue_full_error()
        self.assertEqual(exc.status_code, 503)
        self.assertEqual(exc.detail["reason"], "queue_full")
        self.assertIn("busy", exc.detail["message"])

    def test_worker_not_ready_reason(self):
        exc = worker_not_ready_error()
        self.assertEqual(exc.detail["reason"], "worker_not_ready")

    def test_worker_restarting_reason(self):
        exc = worker_restarting_error()
        self.assertEqual(exc.detail["reason"], "worker_restarting")

    def test_timeout_recovery_reason(self):
        exc = timeout_recovery_error(30.0)
        self.assertEqual(exc.status_code, 504)
        self.assertEqual(exc.detail["reason"], "timeout_recovery")


class ToneBoundaryTest(unittest.TestCase):
    def test_perform_asr_does_not_call_tone(self):
        import inspect
        import utterance_asr

        source = inspect.getsource(utterance_asr.perform_asr)
        self.assertNotIn("run_tone_inference", source)

    def test_api_routes_still_calls_tone_after_asr(self):
        import inspect
        import api_routes

        source = inspect.getsource(api_routes.process_utterance)
        self.assertIn("run_tone_inference", source)
        self.assertIn("perform_asr", source)
        idx_asr = source.index("perform_asr")
        idx_tone = source.index("run_tone_inference")
        self.assertLess(idx_asr, idx_tone)


if __name__ == "__main__":
    unittest.main()
