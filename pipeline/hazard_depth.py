"""浸水深の区分の文字列（「0.5～3.0m未満」「5m以上10m未満」など）を数値の範囲にする。"""
from __future__ import annotations

import re
import unicodedata

_NUMBER = r"(\d+(?:\.\d+)?)\s*m?"
# 「0.5～3.0m未満」「0.3～1.0m」（津波は「未満」が付かない）
_RANGE = re.compile(_NUMBER + r"(?:以上)?[～〜~\-－]" + _NUMBER + r"(?:未満)?")


def parse_depth_range(text: str) -> tuple[float, float | None]:
    """「0.5～3.0m未満」→(0.5, 3.0)、「0.3～1.0m」→(0.3, 1.0)、「5m以上10m未満」→(5.0, 10.0)、「0.5m未満」→(0.0, 0.5)、「20m以上」「5.0m～」→(20.0, None)・(5.0, None)。

    読み取れなければ ValueError（LUNA_TASKS.md T17: 止まって質問する）。
    """
    normalized = unicodedata.normalize("NFKC", text).replace(" ", "")
    ranged = _RANGE.search(normalized)
    if ranged:
        return float(ranged.group(1)), float(ranged.group(2))
    open_ended = re.fullmatch(_NUMBER + r"(?:以上)?[～〜~\-－]", normalized)  # 「5.0m～」（上限なし）
    if open_ended:
        return float(open_ended.group(1)), None
    lower = re.search(_NUMBER + r"以上", normalized)
    upper = re.search(_NUMBER + r"未満", normalized)
    if lower is None and upper is None:
        raise ValueError(f"浸水深の区分を読み取れません: {text!r}")
    return (float(lower.group(1)) if lower else 0.0), (float(upper.group(1)) if upper else None)
