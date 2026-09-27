"""不動産情報ライブラリ API（XIT001）で取引・成約価格を取得する（python -m pipeline.fetch_transactions）。"""
from __future__ import annotations

import argparse
import csv
import hashlib
import logging
from datetime import date
from pathlib import Path
from typing import Any

from pipeline.common.config import load_area
from pipeline.common.parse import (
    normalize_text,
    parse_area,
    parse_building_year,
    parse_period,
    parse_price,
    parse_renovation,
    seismic_class,
)
from pipeline.common.paths import INTERIM_DIR, RAW_DIR
from pipeline.import_csv import OUTPUT_FIELDS, TARGET_TYPE
from pipeline.reinfolib.client import ApiNotFoundError, ReinfolibClient

LOGGER = logging.getLogger(__name__)
OUTPUT_PATH = INTERIM_DIR / "transactions_api.csv"
KANSAI_PATH = INTERIM_DIR / "kansai_transactions.csv"
# 関西平均（2府4県）の騰落指数用。滋賀・京都・大阪・兵庫・奈良・和歌山
KANSAI_PREFECTURES = {"25": "滋賀県", "26": "京都府", "27": "大阪府", "28": "兵庫県", "29": "奈良県", "30": "和歌山県"}
KANSAI_FIELDS = ["price_category", "prefecture_code", "municipality_code", "period", "price_per_sqm", "area_sqm", "age_at_trade", "remarks"]
FIRST_YEAR = 2021
CLASSIFICATIONS = {"02": "contract", "01": "trade"}
CITY_PREFIXES = ("京都市", "大阪市")


class ShapeError(RuntimeError):
    """API の応答の形が LUNA_TASKS.md の想定と違う。"""


def names_match(config_name: str, api_name: str) -> bool:
    """「京都市」「大阪市」の有無の違いだけなら一致とみなす（XIT002 は区名だけを返す）。"""
    if config_name == api_name:
        return True
    return any(config_name == prefix + api_name for prefix in CITY_PREFIXES)


def verify_municipalities(client: ReinfolibClient, area: dict[str, Any]) -> None:
    mismatches: list[str] = []
    for pref in area["prefectures"]:
        data = client.get("XIT002", {"area": pref}, RAW_DIR / "xit002" / f"{pref}.json")
        rows = data.get("data") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            raise ShapeError(f"XIT002 の応答に data 配列がありません: {type(data).__name__}")
        api_names = {str(row.get("id")): str(row.get("name")) for row in rows}
        for item in area["municipalities"]:
            if not item["code"].startswith(pref):
                continue
            api_name = api_names.get(item["code"])
            if api_name is None or not names_match(item["name"], api_name):
                mismatches.append(f"{item['code']} {item['name']}（API: {api_name}）")
    if mismatches:
        raise ValueError("area.json の市区町村コードと名前が API と一致しません: " + "、".join(mismatches))
    LOGGER.info("市区町村コードを XIT002 で照合しました")


def quarters_to_fetch(today: date) -> list[tuple[int, int]]:
    result = []
    for year in range(FIRST_YEAR, today.year + 1):
        for quarter in range(1, 5):
            if date(year, 3 * quarter - 2, 1) <= today:
                result.append((year, quarter))
    return result


def is_recent(year: int, quarter: int, today: date) -> bool:
    """今日から1年以内に終わる四半期は、データが後から追加されることがあるため毎回取り直す。"""
    end_month = 3 * quarter
    end = date(year + (1 if end_month == 12 else 0), 1 if end_month == 12 else end_month + 1, 1)
    return (today - end).days < 365


def convert_rows(rows: list[dict[str, Any]], classification: str, cache_key: str, municipalities: dict[str, str]) -> list[dict[str, Any]]:
    converted: list[dict[str, Any]] = []
    expected = CLASSIFICATIONS[classification]
    for index, row in enumerate(rows):
        if normalize_text(row.get("Type")) != TARGET_TYPE:
            continue
        code = normalize_text(row.get("MunicipalityCode")) or ""
        if code not in municipalities:
            continue
        category_text = normalize_text(row.get("PriceCategory")) or ""
        if category_text and ("成約" in category_text) != (expected == "contract"):
            LOGGER.warning("PriceCategory %r が要求した区分 %s と違います（%s）", category_text, classification, cache_key)
        period = parse_period(row.get("Period"))
        price = parse_price(row.get("TradePrice"))
        area_sqm, area_capped = parse_area(row.get("Area"))
        building_year, prewar = parse_building_year(row.get("BuildingYear"))
        trade_year = int(period[:4]) if period else None
        converted.append({
            "id": hashlib.sha1(f"api|{cache_key}|{index}".encode("utf-8")).hexdigest()[:12],
            "price_category": expected,
            "municipality_code": code,
            "municipality": municipalities[code],
            "district": normalize_text(row.get("DistrictName")) or "",
            "period": period or "",
            "price_yen": price if price is not None else "",
            "area_sqm": area_sqm if area_sqm is not None else "",
            "area_capped": area_capped,
            "price_per_sqm": price / area_sqm if price is not None and area_sqm else "",
            "building_year": building_year if building_year is not None else "",
            "prewar": prewar,
            "age_at_trade": trade_year - building_year if trade_year is not None and building_year else "",
            "seismic": seismic_class(building_year, prewar),
            "floor_plan": normalize_text(row.get("FloorPlan")) or "",
            "structure": normalize_text(row.get("Structure")) or "",
            "renovation": parse_renovation(row.get("Renovation")),
            "nearest_station": "",
            "walk_minutes": "",
            "walk_capped": False,
            "remarks": normalize_text(row.get("Remarks")) or "",
            "source": "api",
            "excluded_reason": "",
        })
    return converted


def fetch_transactions(
    client: ReinfolibClient | None = None,
    today: date | None = None,
    force: bool = False,
    output_path: Path = OUTPUT_PATH,
) -> list[dict[str, Any]]:
    client = client or ReinfolibClient()
    today = today or date.today()
    area = load_area()
    verify_municipalities(client, area)
    municipalities = {item["code"]: item["name"] for item in area["municipalities"]}
    rows_out: list[dict[str, Any]] = []
    for pref in area["prefectures"]:
        for classification in CLASSIFICATIONS:
            for year, quarter in quarters_to_fetch(today):
                cache_key = f"{pref}_{year}Q{quarter}_{classification}"
                try:
                    data = client.get(
                        "XIT001",
                        {"year": year, "quarter": quarter, "area": pref, "priceClassification": classification, "language": "ja"},
                        RAW_DIR / "xit001" / f"{cache_key}.json",
                        force=force or is_recent(year, quarter, today),
                    )
                except ApiNotFoundError:
                    if not is_recent(year, quarter, today):
                        raise
                    LOGGER.info("%s は未公開のため飛ばします", cache_key)
                    continue
                if not isinstance(data, dict) or not isinstance(data.get("data"), list):
                    raise ShapeError(f"XIT001 の応答が {{status, data: [...]}} の形ではありません（{cache_key}）")
                converted = convert_rows(data["data"], classification, cache_key, municipalities)
                rows_out.extend(converted)
                LOGGER.info("%s: 全 %d件、対象 %d件", cache_key, len(data["data"]), len(converted))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(rows_out)
    LOGGER.info("API から %d件を書き出しました（リクエスト %d回）", len(rows_out), client.requests_made)
    return rows_out


def fetch_kansai_transactions(
    client: ReinfolibClient | None = None,
    today: date | None = None,
    output_path: Path = KANSAI_PATH,
) -> int:
    """関西2府4県の中古マンション等（全市区町村）を、騰落指数の関西平均用に書き出す。サイトには載せない。"""
    client = client or ReinfolibClient()
    today = today or date.today()
    count = 0
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=KANSAI_FIELDS)
        writer.writeheader()
        for pref in KANSAI_PREFECTURES:
            for classification, category in CLASSIFICATIONS.items():
                for year, quarter in quarters_to_fetch(today):
                    cache_key = f"{pref}_{year}Q{quarter}_{classification}"
                    try:
                        data = client.get(
                            "XIT001",
                            {"year": year, "quarter": quarter, "area": pref, "priceClassification": classification, "language": "ja"},
                            RAW_DIR / "xit001" / f"{cache_key}.json",
                            force=is_recent(year, quarter, today),
                        )
                    except ApiNotFoundError:
                        if not is_recent(year, quarter, today):
                            raise
                        continue
                    for row in data.get("data", []):
                        if normalize_text(row.get("Type")) != TARGET_TYPE:
                            continue
                        period = parse_period(row.get("Period"))
                        price = parse_price(row.get("TradePrice"))
                        area_sqm, area_capped = parse_area(row.get("Area"))
                        building_year, _ = parse_building_year(row.get("BuildingYear"))
                        if not period or not price or not area_sqm or area_capped or not building_year:
                            continue
                        writer.writerow({
                            "price_category": category,
                            "prefecture_code": pref,
                            "municipality_code": normalize_text(row.get("MunicipalityCode")) or "",
                            "period": period,
                            "price_per_sqm": round(price / area_sqm, 1),
                            "area_sqm": area_sqm,
                            "age_at_trade": int(period[:4]) - building_year,
                            "remarks": normalize_text(row.get("Remarks")) or "",
                        })
                        count += 1
    LOGGER.info("関西2府4県の中古マンション等 %d件を書き出しました（リクエスト %d回）", count, client.requests_made)
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="不動産情報ライブラリ API で取引・成約価格を取得します")
    parser.add_argument("--force", action="store_true", help="キャッシュを使わず取り直す")
    parser.add_argument("--kansai", action="store_true", help="関西平均用に2府4県の全市区町村も取得する")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    fetch_transactions(force=args.force)
    if args.kansai:
        fetch_kansai_transactions()


if __name__ == "__main__":
    main()
