from __future__ import annotations

import re
from typing import TypedDict, cast

from pipeline.common.paths import CONFIG_DIR, load_json


class MunicipalityConfig(TypedDict):
    code: str
    name: str
    group: str


class AreaConfig(TypedDict):
    prefectures: dict[str, str]
    groups: dict[str, str]
    municipalities: list[MunicipalityConfig]
    bbox: dict[str, float]
    target_lines: list[dict[str, str]]
    hazard: dict[str, float | int]


class CreditSource(TypedDict):
    id: str
    name: str
    url: str
    credit: str
    usage: str


class RemarksConfig(TypedDict):
    separator: str
    exclude: list[str]
    keep: list[str]
    confirmedAt: str


AREA_PATH = CONFIG_DIR / "area.json"
CREDITS_PATH = CONFIG_DIR / "credits.json"
REMARKS_PATH = CONFIG_DIR / "remarks.json"


def load_area() -> AreaConfig:
    area = load_json(AREA_PATH)
    if not isinstance(area, dict):
        raise ValueError("エリア設定は JSON オブジェクトである必要があります")

    prefectures = area.get("prefectures")
    groups = area.get("groups")
    municipalities = area.get("municipalities")
    if not isinstance(prefectures, dict) or not isinstance(groups, dict):
        raise ValueError("prefectures と groups は JSON オブジェクトである必要があります")
    if not isinstance(municipalities, list):
        raise ValueError("municipalities は配列である必要があります")

    seen_codes: set[str] = set()
    for municipality in municipalities:
        if not isinstance(municipality, dict):
            raise ValueError("municipalities の各要素は JSON オブジェクトである必要があります")
        code = municipality.get("code")
        group = municipality.get("group")
        if not isinstance(code, str) or re.fullmatch(r"\d{5}", code) is None:
            raise ValueError(f"市区町村コードは5桁の数字である必要があります: {code!r}")
        if code in seen_codes:
            raise ValueError(f"市区町村コードが重複しています: {code}")
        seen_codes.add(code)
        if not isinstance(group, str) or group not in groups:
            raise ValueError(f"市区町村コード {code} の group が設定されていません: {group!r}")
        if code[:2] not in prefectures:
            raise ValueError(f"市区町村コード {code} の都道府県コードが設定されていません")

    return cast(AreaConfig, area)


def municipality_codes() -> set[str]:
    return {municipality["code"] for municipality in load_area()["municipalities"]}


def group_of(code: str) -> str:
    for municipality in load_area()["municipalities"]:
        if municipality["code"] == code:
            return municipality["group"]
    raise KeyError(f"市区町村コードが設定にありません: {code}")


def load_credits() -> list[CreditSource]:
    credits = load_json(CREDITS_PATH)
    if not isinstance(credits, dict) or not isinstance(credits.get("sources"), list):
        raise ValueError("出典設定には sources 配列が必要です")

    sources = credits["sources"]
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("sources の各要素は JSON オブジェクトである必要があります")
        credit = source.get("credit")
        if not isinstance(credit, str) or not credit.strip():
            raise ValueError("出典の credit は空にできません")
    return cast(list[CreditSource], sources)


def load_remarks() -> RemarksConfig:
    remarks = load_json(REMARKS_PATH)
    if not isinstance(remarks, dict):
        raise ValueError("取引の事情等の設定は JSON オブジェクトである必要があります")
    separator = remarks.get("separator")
    if not isinstance(separator, str) or not separator:
        raise ValueError("remarks.json の separator が空です")
    for key in ("exclude", "keep"):
        values = remarks.get(key)
        if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
            raise ValueError(f"remarks.json の {key} は文字列の配列である必要があります")
    overlap = set(remarks["exclude"]) & set(remarks["keep"])
    if overlap:
        raise ValueError(f"remarks.json の exclude と keep に同じ値があります: {sorted(overlap)}")
    return cast(RemarksConfig, remarks)
