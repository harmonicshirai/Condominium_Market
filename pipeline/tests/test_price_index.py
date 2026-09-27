from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.build_price_index import build_price_index


def test_hedonic_index_recovers_quarter_effects() -> None:
    rng = np.random.default_rng(0)
    true_effects = [0.0, 0.05, 0.10, 0.08]
    periods = ["2024Q1", "2024Q2", "2024Q3", "2024Q4"]
    records = []
    for period_index, period in enumerate(periods):
        for _ in range(100):
            age = int(rng.integers(0, 41))
            area = float(rng.uniform(40, 100))
            municipality_code = str(rng.choice(["26104", "28202"]))
            municipality_effect = 0.12 if municipality_code == "28202" else 0.0
            log_price = (
                true_effects[period_index]
                + municipality_effect
                - 0.02 * age
                + 0.0002 * age**2
                + 0.4 * np.log(area)
                + rng.normal(0, 0.05)
            )
            records.append(
                {
                    "price_category": "contract",
                    "municipality_code": municipality_code,
                    "period": period,
                    "building_year": 2024 - age,
                    "age_at_trade": age,
                    "area_sqm": area,
                    "price_per_sqm": float(np.exp(log_price)),
                    "excluded_reason": "",
                }
            )

    result = build_price_index(pd.DataFrame(records))
    assert result["basePeriod"] == "2024Q4"
    assert result["points"][-1]["value"] == 1.0
    estimated = np.log([point["value"] for point in result["points"]])
    expected = np.asarray(true_effects) - true_effects[-1]
    assert np.max(np.abs(estimated - expected)) < 0.02
    assert all(point["n"] == 100 and point["lowN"] is False for point in result["points"])


def test_no_contract_rows_produces_empty_index() -> None:
    result = build_price_index(
        pd.DataFrame(
            [{"price_category": "trade", "period": "2024Q1", "excluded_reason": ""}]
        )
    )
    assert result["basePeriod"] == ""
    assert result["points"] == []
