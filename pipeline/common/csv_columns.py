from __future__ import annotations

import unicodedata
from collections.abc import Sequence


CSV_COLUMNS: dict[str, tuple[str, ...]] = {
    "type": ("種類",),
    "price_category": ("価格情報区分",),
    "municipality_code": ("市区町村コード",),
    "municipality": ("市区町村名",),
    "district": ("地区名",),
    "station": ("最寄駅：名称",),
    "walk": ("最寄駅：距離（分）",),
    "price": ("取引価格（総額）",),
    "area": ("面積（㎡）",),
    "floor_plan": ("間取り",),
    "building_year": ("建築年",),
    "structure": ("建物の構造",),
    "period": ("取引時期",),
    "renovation": ("改装",),
    "remarks": ("取引の事情等",),
}

REQUIRED_COLUMNS = frozenset(
    {
        "type",
        "price_category",
        "municipality_code",
        "municipality",
        "price",
        "area",
        "building_year",
        "period",
    }
)


def normalize_header(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip()


def resolve_columns(headers: Sequence[str]) -> dict[str, str]:
    normalized_to_original: dict[str, str] = {}
    for header in headers:
        normalized = normalize_header(header)
        if normalized in normalized_to_original:
            raise ValueError(f"CSV の見出しが正規化後に重複しています: {normalized}")
        normalized_to_original[normalized] = header

    result: dict[str, str] = {}
    for internal_name, candidates in CSV_COLUMNS.items():
        for candidate in candidates:
            original = normalized_to_original.get(normalize_header(candidate))
            if original is not None:
                result[internal_name] = original
                break

    missing = sorted(REQUIRED_COLUMNS - result.keys())
    if missing:
        raise ValueError(
            "CSV の必須列が見つかりません。"
            f"不足: {', '.join(missing)}。"
            f"実際の見出し: {', '.join(headers)}"
        )
    return result
