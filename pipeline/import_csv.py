from __future__ import annotations

import csv
import hashlib
import logging
from collections import Counter
from pathlib import Path
from typing import Any

from pipeline.common.config import load_area
from pipeline.common.csv_columns import resolve_columns
from pipeline.common.parse import (
    index_to_period,
    normalize_text,
    period_index,
    parse_area,
    parse_building_year,
    parse_period,
    parse_price,
    parse_renovation,
    parse_walk_minutes,
    seismic_class,
)
from pipeline.common.paths import INTERIM_DIR, MANUAL_CSV_DIR

LOGGER = logging.getLogger(__name__)
OUTPUT_PATH = INTERIM_DIR / "transactions_csv.csv"
# CSV の自治体名に郡名が付く表記を、確認済みのコードに限って許容する。
MUNICIPALITY_ALIASES = {"26303": {"乙訓郡大山崎町"}, "27301": {"三島郡島本町"}}
OUTPUT_FIELDS = [
    "id",
    "price_category",
    "municipality_code",
    "municipality",
    "district",
    "period",
    "price_yen",
    "area_sqm",
    "area_capped",
    "price_per_sqm",
    "building_year",
    "prewar",
    "age_at_trade",
    "seismic",
    "floor_plan",
    "structure",
    "renovation",
    "nearest_station",
    "walk_minutes",
    "walk_capped",
    "remarks",
    "source",
    "excluded_reason",
]
# §2.3 の対象期間。これより前の四半期は取り込まない。
PERIOD_FROM = "2021Q1"
TARGET_TYPE = "中古マンション等"


def _read_rows(path: Path) -> tuple[list[str], list[dict[str, str]], str]:
    last_error: UnicodeDecodeError | None = None
    for encoding in ("utf-8-sig", "cp932"):
        try:
            with path.open("r", encoding=encoding, newline="") as file:
                reader = csv.DictReader(file)
                if reader.fieldnames is None:
                    raise ValueError(f"CSV に見出し行がありません: {path.name}")
                return reader.fieldnames, list(reader), encoding
        except UnicodeDecodeError as error:
            last_error = error
    raise ValueError(f"CSV を UTF-8 または CP932 として読めません: {path.name}") from last_error


def _category(value: str | None) -> str:
    normalized = normalize_text(value) or ""
    if "成約" in normalized:
        return "contract"
    if "取引" in normalized:
        return "trade"
    raise ValueError(f"価格情報区分を判定できません: {normalized!r}")


def _value(row: dict[str, str], columns: dict[str, str], key: str) -> str | None:
    header = columns.get(key)
    return row.get(header) if header is not None else None


def _convert_row(
    row: dict[str, str],
    columns: dict[str, str],
    source_name: str,
    row_number: int,
    canonical_municipality: str,
) -> dict[str, Any]:
    municipality_code = normalize_text(_value(row, columns, "municipality_code")) or ""
    municipality = canonical_municipality
    district = normalize_text(_value(row, columns, "district"))
    period = parse_period(_value(row, columns, "period"))
    price_yen = parse_price(_value(row, columns, "price"))
    area_sqm, area_capped = parse_area(_value(row, columns, "area"))
    building_year, prewar = parse_building_year(_value(row, columns, "building_year"))
    walk_minutes, walk_capped = parse_walk_minutes(_value(row, columns, "walk"))
    price_per_sqm = (
        price_yen / area_sqm
        if price_yen is not None and area_sqm is not None and area_sqm > 0
        else None
    )
    trade_year = int(period[:4]) if period is not None else None
    age_at_trade = trade_year - building_year if trade_year is not None and building_year else None
    digest = hashlib.sha1(
        f"csv|{source_name}|{row_number}".encode("utf-8")
    ).hexdigest()[:12]

    return {
        "id": digest,
        "price_category": _category(_value(row, columns, "price_category")),
        "municipality_code": municipality_code,
        "municipality": municipality,
        "district": district or "",
        "period": period or "",
        "price_yen": price_yen if price_yen is not None else "",
        "area_sqm": area_sqm if area_sqm is not None else "",
        "area_capped": area_capped,
        "price_per_sqm": price_per_sqm if price_per_sqm is not None else "",
        "building_year": building_year if building_year is not None else "",
        "prewar": prewar,
        "age_at_trade": age_at_trade if age_at_trade is not None else "",
        "seismic": seismic_class(building_year, prewar),
        "floor_plan": normalize_text(_value(row, columns, "floor_plan")) or "",
        "structure": normalize_text(_value(row, columns, "structure")) or "",
        "renovation": parse_renovation(_value(row, columns, "renovation")),
        "nearest_station": normalize_text(_value(row, columns, "station")) or "",
        "walk_minutes": walk_minutes if walk_minutes is not None else "",
        "walk_capped": walk_capped,
        "remarks": normalize_text(_value(row, columns, "remarks")) or "",
        "source": "csv",
        "excluded_reason": "",
    }


def import_csv(
    source_dir: Path = MANUAL_CSV_DIR,
    output_path: Path = OUTPUT_PATH,
) -> list[dict[str, Any]]:
    files = sorted(source_dir.glob("*.csv"))
    if not files:
        raise FileNotFoundError(
            f"CSV がありません。価格検索から取得したファイルを配置してください: {source_dir}"
        )

    area = load_area()
    municipalities = {item["code"]: item for item in area["municipalities"]}
    seen_names: dict[str, set[str]] = {code: set() for code in municipalities}
    imported: list[dict[str, Any]] = []
    counts: dict[str, int] = {code: 0 for code in municipalities}
    # (区分, 府県コード, 四半期) → その組の行を含むファイル名
    key_files: dict[tuple[str, str, str], set[str]] = {}
    period_from_index = period_index(PERIOD_FROM)
    skipped_old = 0

    for path in files:
        headers, rows, encoding = _read_rows(path)
        columns = resolve_columns(headers)
        LOGGER.info("CSV 読み込み: %s (%s, %s行)", path.name, encoding, len(rows))
        file_rows: list[dict[str, Any]] = []
        file_old = 0
        type_counts: Counter[str] = Counter()
        for row_number, row in enumerate(rows, start=2):
            row_type = normalize_text(_value(row, columns, "type")) or ""
            type_counts[row_type] += 1
            code = normalize_text(_value(row, columns, "municipality_code")) or ""
            if code not in municipalities:
                continue
            name = normalize_text(_value(row, columns, "municipality")) or ""
            seen_names[code].add(name)
            if row_type != TARGET_TYPE:
                continue
            converted = _convert_row(
                row,
                columns,
                path.name,
                row_number,
                municipalities[code]["name"],
            )
            if converted["period"] and period_index(converted["period"]) < period_from_index:
                file_old += 1
                continue
            file_rows.append(converted)

        skipped_old += file_old
        if not file_rows and file_old:
            LOGGER.warning(
                "対象期間（%s〜）の行がないファイルを飛ばしました: %s（それより前の中古マンション等 %d件）",
                PERIOD_FROM, path.name, file_old,
            )
            continue
        if not file_rows:
            LOGGER.warning(
                "対象の行がないファイルを飛ばしました: %s（種類: %s）",
                path.name,
                "、".join(f"{kind or '空欄'} {count}件" for kind, count in type_counts.most_common()),
            )
            continue
        for converted in file_rows:
            key = (converted["price_category"], converted["municipality_code"][:2], converted["period"])
            key_files.setdefault(key, set()).add(path.name)
            counts[converted["municipality_code"]] += 1
        imported.extend(file_rows)

    duplicates = {key: names for key, names in key_files.items() if len(names) > 1}
    if duplicates:
        details = "\n".join(
            f"  {category} {pref} {period}: {', '.join(sorted(names))}"
            for (category, pref, period), names in sorted(duplicates.items())
        )
        raise ValueError(
            "同じ区分・府県・四半期が複数のファイルに入っています。"
            "どちらかのファイルを data/manual_csv/ から外してください。\n" + details
        )
    if skipped_old:
        LOGGER.info("%s より前の四半期の %d行は取り込みませんでした", PERIOD_FROM, skipped_old)

    mismatches = {
        code: names
        for code, names in seen_names.items()
        if names
        and not names.issubset(
            {municipalities[code]["name"], *MUNICIPALITY_ALIASES.get(code, set())}
        )
    }
    if mismatches:
        raise ValueError(f"市区町村コードと名前が area.json と一致しません: {mismatches}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(imported)

    missing_codes = [
        item["code"] for item in area["municipalities"] if not seen_names[item["code"]]
    ]
    if missing_codes:
        LOGGER.warning("CSV に行がない市区町村コード: %s", ", ".join(missing_codes))

    LOGGER.info("取り込み件数: %d", len(imported))
    for code, item in municipalities.items():
        LOGGER.info("%s %s: %d件", code, item["name"], counts[code])
    _log_coverage(imported, area["prefectures"])
    return imported


def find_missing_periods(
    imported: list[dict[str, Any]], prefectures: dict[str, str]
) -> dict[tuple[str, str], list[str]]:
    """府県×区分ごとに、PERIOD_FROM から最新四半期までで1行もない四半期を返す。"""
    periods = [row["period"] for row in imported if row["period"]]
    if not periods:
        return {}
    first = period_index(PERIOD_FROM)
    last = max(period_index(period) for period in periods)
    present: dict[tuple[str, str], set[int]] = {}
    for row in imported:
        if row["period"]:
            key = (row["municipality_code"][:2], row["price_category"])
            present.setdefault(key, set()).add(period_index(row["period"]))
    missing: dict[tuple[str, str], list[str]] = {}
    for pref in prefectures:
        for category in ("contract", "trade"):
            have = present.get((pref, category), set())
            gaps = [index_to_period(i) for i in range(first, last + 1) if i not in have]
            if gaps:
                missing[(pref, category)] = gaps
    return missing


def _log_coverage(imported: list[dict[str, Any]], prefectures: dict[str, str]) -> None:
    summary: dict[tuple[str, str], list[str]] = {}
    for row in imported:
        if row["period"]:
            summary.setdefault((row["municipality_code"][:2], row["price_category"]), []).append(row["period"])
    LOGGER.info("府県×区分ごとの件数と期間:")
    for (pref, category), periods in sorted(summary.items()):
        ordered = sorted(periods, key=period_index)
        LOGGER.info("  %s %s: %d件（%s〜%s）", prefectures.get(pref, pref), category, len(periods), ordered[0], ordered[-1])
    for (pref, category), gaps in find_missing_periods(imported, prefectures).items():
        LOGGER.warning(
            "%s %s に行がない四半期（%d期）: %s",
            prefectures.get(pref, pref), category, len(gaps), ", ".join(gaps),
        )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    import_csv()


if __name__ == "__main__":
    main()
