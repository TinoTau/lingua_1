"""Unicode codepoint alignment — mirrors Scheduler align.rs (Myers/DP)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Optional


class SpanOperation(str, Enum):
    REPLACE = "REPLACE"
    INSERT = "INSERT"
    DELETE = "DELETE"


@dataclass(frozen=True)
class AlignedCorrectionSpan:
    source_start: int
    source_end: int
    target_start: int
    target_end: int
    source_text: str
    target_text: str
    operation: SpanOperation

    def to_dict(self) -> dict:
        d = asdict(self)
        d["operation"] = self.operation.value
        return d


def canonicalize_for_alignment(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\r", "\n")


def align_codepoints(system: str, corrected: str) -> list[AlignedCorrectionSpan]:
    """GT=corrected target text, hyp=system (ASR) — same semantics as Phase3 normalizer."""
    a = list(canonicalize_for_alignment(system))
    b = list(canonicalize_for_alignment(corrected))
    if a == b:
        return []

    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)

    ops: list[tuple[SpanOperation, int, int, Optional[str], Optional[str]]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and a[i - 1] == b[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            i -= 1
            j -= 1
            continue
        if i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            ops.append((SpanOperation.REPLACE, i - 1, j - 1, a[i - 1], b[j - 1]))
            i -= 1
            j -= 1
            continue
        if i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            ops.append((SpanOperation.DELETE, i - 1, j, a[i - 1], None))
            i -= 1
            continue
        ops.append((SpanOperation.INSERT, i, j - 1, None, b[j - 1]))
        j -= 1
    ops.reverse()
    return _coalesce_ops(ops)


def _is_adjacent(
    prev: tuple[SpanOperation, int, int, Optional[str], Optional[str]],
    nxt: tuple[SpanOperation, int, int, Optional[str], Optional[str]],
    op: SpanOperation,
) -> bool:
    if op == SpanOperation.REPLACE:
        return prev[1] + 1 == nxt[1] and prev[2] + 1 == nxt[2]
    if op == SpanOperation.DELETE:
        return prev[1] + 1 == nxt[1] and prev[2] == nxt[2]
    return prev[1] == nxt[1] and prev[2] + 1 == nxt[2]


def _coalesce_ops(
    ops: list[tuple[SpanOperation, int, int, Optional[str], Optional[str]]],
) -> list[AlignedCorrectionSpan]:
    out: list[AlignedCorrectionSpan] = []
    idx = 0
    while idx < len(ops):
        op0 = ops[idx][0]
        k = idx + 1
        while k < len(ops) and ops[k][0] == op0 and _is_adjacent(ops[k - 1], ops[k], op0):
            k += 1
        slice_ = ops[idx:k]
        if op0 == SpanOperation.REPLACE:
            out.append(
                AlignedCorrectionSpan(
                    source_start=slice_[0][1],
                    source_end=slice_[-1][1] + 1,
                    target_start=slice_[0][2],
                    target_end=slice_[-1][2] + 1,
                    source_text="".join(o[3] for o in slice_ if o[3] is not None),
                    target_text="".join(o[4] for o in slice_ if o[4] is not None),
                    operation=SpanOperation.REPLACE,
                )
            )
        elif op0 == SpanOperation.DELETE:
            out.append(
                AlignedCorrectionSpan(
                    source_start=slice_[0][1],
                    source_end=slice_[-1][1] + 1,
                    target_start=slice_[0][2],
                    target_end=slice_[0][2],
                    source_text="".join(o[3] for o in slice_ if o[3] is not None),
                    target_text="",
                    operation=SpanOperation.DELETE,
                )
            )
        else:
            out.append(
                AlignedCorrectionSpan(
                    source_start=slice_[0][1],
                    source_end=slice_[0][1],
                    target_start=slice_[0][2],
                    target_end=slice_[-1][2] + 1,
                    source_text="",
                    target_text="".join(o[4] for o in slice_ if o[4] is not None),
                    operation=SpanOperation.INSERT,
                )
            )
        idx = k
    return out
