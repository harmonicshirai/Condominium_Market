from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.common.parse import index_to_period, period_index
from pipeline.common.paths import INTERIM_DIR
from pipeline.common.paths import write_json

LOGGER = logging.getLogger(__name__)
INPUT_PATH = INTERIM_DIR / "transactions.csv"
OUTPUT_PATH = INTERIM_DIR / "price_index.json"


def build_price_index(frame: pd.DataFrame) -> dict[str, Any]:
    data = frame.copy()
    if "excluded_reason" in data:
        data = data.loc[data["excluded_reason"].astype(str).eq("")]
    data = data.loc[data["price_category"].astype(str).eq("contract")].copy()
    generated_at = datetime.now(timezone.utc).isoformat()
    if data.empty:
        LOGGER.warning("価格指数の対象となる成約事例がありません")
        return {"method": "time_dummy_hedonic", "basePeriod": "", "points": [], "generatedAt": generated_at}

    for column in ("building_year", "age_at_trade", "area_sqm", "price_per_sqm"):
        data[column] = pd.to_numeric(data[column], errors="coerce")
    data = data.dropna(subset=["age_at_trade", "building_year", "area_sqm", "price_per_sqm"])
    data = data.loc[data["area_sqm"].gt(0) & data["price_per_sqm"].gt(0)]

    if data.empty:
        LOGGER.warning("価格指数の対象となる成約事例がありません")
        return {"method": "time_dummy_hedonic", "basePeriod": "", "points": [], "generatedAt": generated_at}

    periods = sorted(data["period"].astype(str).unique(), key=period_index)
    municipalities = sorted(data["municipality_code"].astype(str).unique())
    period_columns = [period for period in periods if period != periods[0]]
    municipality_columns = [code for code in municipalities if code != municipalities[0]]
    columns: list[np.ndarray] = [np.ones(len(data), dtype=float)]
    for period in period_columns:
        columns.append(data["period"].astype(str).eq(period).to_numpy(dtype=float))
    for code in municipality_columns:
        columns.append(data["municipality_code"].astype(str).eq(code).to_numpy(dtype=float))
    age = data["age_at_trade"].to_numpy(dtype=float)
    columns.extend([age, age**2, np.log(data["area_sqm"].to_numpy(dtype=float))])
    design = np.column_stack(columns)
    target = np.log(data["price_per_sqm"].to_numpy(dtype=float))
    coefficients, _, _, _ = np.linalg.lstsq(design, target, rcond=None)

    quarter_coefficients = {periods[0]: 0.0}
    for index, period in enumerate(period_columns, start=1):
        quarter_coefficients[period] = float(coefficients[index])
    raw_values = {period: float(np.exp(quarter_coefficients[period])) for period in periods}
    counts = data.groupby(data["period"].astype(str)).size().to_dict()
    eligible_base = [period for period in periods if int(counts[period]) >= 30]
    if eligible_base:
        base_period = eligible_base[-1]
    else:
        base_period = periods[-1]
        LOGGER.warning("30件以上の四半期がないため、最新の成約四半期を基準にします")
    base_value = raw_values[base_period]
    points = [
        {
            "period": period,
            "value": raw_values[period] / base_value,
            "n": int(counts[period]),
            "lowN": int(counts[period]) < 30,
        }
        for period in periods
    ]
    return {
        "method": "time_dummy_hedonic",
        "basePeriod": base_period,
        "points": points,
        "generatedAt": generated_at,
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    frame = pd.read_csv(INPUT_PATH, dtype={"municipality_code": "string"}, keep_default_na=False)
    result = build_price_index(frame)
    write_json(OUTPUT_PATH, result)
    for point in result["points"]:
        LOGGER.info("%s value=%.4f n=%d", point["period"], point["value"], point["n"])


if __name__ == "__main__":
    main()
