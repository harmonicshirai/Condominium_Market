from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from pipeline.build_site_data import build_site_data


def _transaction(code: str) -> dict[str, object]:
    return {
        "id": "sample-id",
        "price_category": "contract",
        "municipality_code": code,
        "municipality": "尼崎市",
        "district": "中央",
        "period": "2024Q1",
        "price_yen": 35_050_000,
        "area_sqm": 70.04,
        "price_per_sqm": 500_999.4,
        "building_year": 2000,
        "age_at_trade": 24,
        "seismic": "new",
        "floor_plan": "3LDK",
        "structure": "RC",
        "renovation": "unknown",
        "nearest_station": "尼崎",
        "walk_minutes": 5,
        "source": "csv",
        "excluded_reason": "",
    }


def test_build_site_data_outputs_all_transaction_fields(tmp_path: Path) -> None:
    transactions_path = tmp_path / "transactions.csv"
    pd.DataFrame([_transaction("28202")]).to_csv(transactions_path, index=False)
    price_index_path = tmp_path / "price_index.json"
    price_index_path.write_text(
        json.dumps({"method": "time_dummy_hedonic", "basePeriod": "2024Q1", "points": [], "generatedAt": "now"}),
        encoding="utf-8",
    )
    output_dir = tmp_path / "site-data"

    build_site_data(transactions_path, price_index_path, output_dir)

    transaction = json.loads((output_dir / "transactions" / "28202.json").read_text(encoding="utf-8"))[0]
    assert transaction["areaSqm"] == 70.0
    assert transaction["pricePerSqm"] == 500_999
    assert set(transaction) == {
        "id", "priceCategory", "municipalityCode", "district", "period", "priceYen",
        "areaSqm", "pricePerSqm", "buildingYear", "ageAtTrade", "seismic", "floorPlan",
        "structure", "renovation", "nearestStation", "walkMinutes", "source",
    }
    meta = json.loads((output_dir / "meta.json").read_text(encoding="utf-8"))
    assert meta["transactionCount"] == 1
    assert meta["periodFrom"] == meta["periodTo"] == "2024Q1"
