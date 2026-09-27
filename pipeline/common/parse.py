from __future__ import annotations

import re
import unicodedata


def normalize_text(s: str | None) -> str | None:
    if s is None:
        return None
    normalized = unicodedata.normalize("NFKC", s).strip()
    return normalized or None


def parse_period(s: str | None) -> str | None:
    normalized = normalize_text(s)
    if normalized is None:
        return None

    japanese = re.fullmatch(r"(\d{4})年第([1-4])四半期", normalized)
    compact = re.fullmatch(r"(\d{4})Q([1-4])", normalized, flags=re.IGNORECASE)
    match = japanese or compact
    if match is None:
        return None
    return f"{match.group(1)}Q{match.group(2)}"


def period_index(p: str) -> int:
    normalized = normalize_text(p)
    if normalized is None:
        raise ValueError("期間は YYYYQn 形式で指定してください")
    match = re.fullmatch(r"(\d{4})Q([1-4])", normalized, flags=re.IGNORECASE)
    if match is None:
        raise ValueError("期間は YYYYQn 形式で指定してください")
    return int(match.group(1)) * 4 + int(match.group(2)) - 1


def index_to_period(i: int) -> str:
    year, quarter_index = divmod(i, 4)
    return f"{year:04d}Q{quarter_index + 1}"


def parse_price(s: str | None) -> int | None:
    normalized = normalize_text(s)
    if normalized is None:
        return None
    if re.fullmatch(r"(?:\d{1,3}(?:,\d{3})+|\d+)", normalized) is None:
        return None
    digits = normalized.replace(",", "")
    return int(digits)


def parse_area(s: str | None) -> tuple[float | None, bool]:
    normalized = normalize_text(s)
    if normalized is None:
        return None, False
    match = re.fullmatch(
        r"((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(?:m2|平米))?(?:\s*(以上))?",
        normalized,
        flags=re.IGNORECASE,
    )
    if match is None:
        return None, False
    return float(match.group(1).replace(",", "")), match.group(2) is not None


def parse_building_year(s: str | None) -> tuple[int | None, bool]:
    normalized = normalize_text(s)
    if normalized is None:
        return None, False
    if normalized == "戦前":
        return None, True

    western = re.fullmatch(r"(\d{4})年?", normalized)
    if western is not None:
        return int(western.group(1)), False

    japanese = re.fullmatch(r"(昭和|平成|令和)(元|\d+)年", normalized)
    if japanese is None:
        return None, False
    era_start = {"昭和": 1925, "平成": 1988, "令和": 2018}[japanese.group(1)]
    era_year = 1 if japanese.group(2) == "元" else int(japanese.group(2))
    return era_start + era_year, False


def seismic_class(year: int | None, prewar: bool) -> str:
    if prewar:
        return "old"
    if year is None:
        return "unknown"
    if year <= 1980:
        return "old"
    if year <= 1982:
        return "unknown"
    return "new"


def parse_renovation(s: str | None) -> str:
    normalized = normalize_text(s)
    if normalized is None:
        return "unknown"
    if "未改装" in normalized:
        return "not_renovated"
    if "改装済" in normalized:
        return "renovated"
    return "unknown"


def _parse_walk_endpoint(value: str) -> int | None:
    normalized = value.strip().upper()
    hour_match = re.fullmatch(r"(\d+)\s*H(?:\s*(\d{1,2}))?", normalized)
    if hour_match is not None:
        hours = int(hour_match.group(1))
        minutes = int(hour_match.group(2) or "0")
        if minutes >= 60:
            return None
        return hours * 60 + minutes

    minute_match = re.fullmatch(r"(\d+)\s*分?", normalized)
    if minute_match is not None:
        return int(minute_match.group(1))
    return None


def parse_walk_minutes(s: str | None) -> tuple[int | None, bool]:
    normalized = normalize_text(s)
    if normalized is None:
        return None, False

    parts = re.split(r"[〜～~?]", normalized)
    if len(parts) == 1:
        return _parse_walk_endpoint(parts[0]), False
    if len(parts) != 2:
        return None, False

    lower = _parse_walk_endpoint(parts[0])
    if lower is None:
        return None, False
    if not parts[1].strip():
        return lower, True
    upper = _parse_walk_endpoint(parts[1])
    if upper is None or upper < lower:
        return None, False
    return (lower + upper + 1) // 2, False
