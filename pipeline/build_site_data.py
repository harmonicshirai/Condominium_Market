from __future__ import annotations

import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from pipeline.common.config import load_area, load_credits
from pipeline.common.paths import INTERIM_DIR, WEB_DATA_DIR, load_json, write_json

LOGGER = logging.getLogger(__name__)
TRANSACTIONS_PATH = INTERIM_DIR / "transactions.csv"
PRICE_INDEX_PATH = INTERIM_DIR / "price_index.json"


def _clean(value: Any) -> str | None:
    if value is None or pd.isna(value) or str(value).strip() == "":
        return None
    return str(value)


def _number(value: Any, integer: bool = False) -> int | float | None:
    if value is None or pd.isna(value) or str(value).strip() == "":
        return None
    parsed = float(value)
    return int(round(parsed)) if integer else parsed


def _transaction(row: pd.Series) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "priceCategory": str(row["price_category"]),
        "municipalityCode": str(row["municipality_code"]).zfill(5),
        "district": _clean(row.get("district")),
        "period": str(row["period"]),
        "priceYen": _number(row["price_yen"], integer=True),
        "areaSqm": round(float(_number(row["area_sqm"])), 1),
        "pricePerSqm": _number(row["price_per_sqm"], integer=True),
        "buildingYear": _number(row.get("building_year"), integer=True),
        "ageAtTrade": _number(row.get("age_at_trade"), integer=True),
        "seismic": str(row["seismic"]),
        "floorPlan": _clean(row.get("floor_plan")),
        "structure": _clean(row.get("structure")),
        "renovation": str(row["renovation"]),
        "nearestStation": _clean(row.get("nearest_station")),
        "walkMinutes": _number(row.get("walk_minutes"), integer=True),
        "source": str(row["source"]),
    }


def build_site_data(
    transactions_path: Path = TRANSACTIONS_PATH,
    price_index_path: Path = PRICE_INDEX_PATH,
    output_dir: Path = WEB_DATA_DIR,
) -> dict[str, Any]:
    frame = pd.read_csv(transactions_path, dtype={"municipality_code": "string"}, keep_default_na=False)
    accepted = frame.loc[frame["excluded_reason"].astype(str).eq("")].copy()
    area = load_area()
    municipality_config = {item["code"]: item for item in area["municipalities"]}
    group_names = area["groups"]
    groups: dict[str, list[dict[str, Any]]] = {code: [] for code in municipality_config}
    for _, row in accepted.iterrows():
        code = str(row["municipality_code"]).zfill(5)
        if code in groups:
            groups[code].append(_transaction(row))
    for code in groups:
        groups[code].sort(key=lambda tx: tx["period"], reverse=True)

    municipalities = []
    for code, item in municipality_config.items():
        txs = groups[code]
        municipalities.append(
            {
                "code": code,
                "name": item["name"],
                "prefectureCode": code[:2],
                "group": item["group"],
                "groupName": group_names[item["group"]],
                "contractCount": sum(tx["priceCategory"] == "contract" for tx in txs),
                "tradeCount": sum(tx["priceCategory"] == "trade" for tx in txs),
                "latestPeriod": max((tx["period"] for tx in txs), default=None),
            }
        )

    periods = accepted["period"].astype(str).tolist() if not accepted.empty else []
    generated_at = datetime.now(timezone.utc).isoformat()
    meta = {
        "generatedAt": generated_at,
        "periodFrom": min(periods) if periods else "",
        "periodTo": max(periods) if periods else "",
        "transactionCount": len(accepted),
        "hasStations": (output_dir / "stations.json").is_file(),
        "hasHazard": (output_dir / "hazard" / "flood" / "index.json").is_file(),
        "sources": load_credits(),
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    transactions_dir = output_dir / "transactions"
    transactions_dir.mkdir(parents=True, exist_ok=True)
    for stale_file in transactions_dir.glob("*.json"):
        stale_file.unlink()
    write_json(output_dir / "meta.json", meta)
    write_json(output_dir / "municipalities.json", municipalities)
    if price_index_path.exists():
        shutil.copyfile(price_index_path, output_dir / "price_index.json")
    else:
        write_json(output_dir / "price_index.json", {"method": "time_dummy_hedonic", "basePeriod": "", "points": [], "generatedAt": generated_at})
    for code, txs in groups.items():
        write_json(transactions_dir / f"{code}.json", txs)

    total_bytes = sum(path.stat().st_size for path in output_dir.rglob("*") if path.is_file())
    LOGGER.info("サイト用データ: %d件、合計 %.2f MB", len(accepted), total_bytes / (1024 * 1024))
    if total_bytes > 50 * 1024 * 1024:
        raise ValueError("web/public/data が50MBを超えています")
    return meta


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    build_site_data()


if __name__ == "__main__":
    main()
