"""地域別の騰落指数（python -m pipeline.build_region_index）→ web/public/data/region_index.json

- 関西平均: 2府4県の中古マンション等（kansai_transactions.csv）。市区町村の固定効果つき
- 市区町村・グループ・駅: 対象エリアの採用済み事例（transactions.csv）。グループは市区町村の固定効果つき
- どれも同じヘドニック回帰: ln(㎡単価) = 四半期の効果 + 築年数 + 築年数² + ln(面積) + 取引価格情報ダミー
- 値は ln 指数（最初の四半期=0）。画面側で任意の基準四半期に合わせて 100 にする
- 4四半期の移動平均（件数で重み付け）も出す。1四半期ごとの件数が少ない地域の揺れを抑えるため
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from pipeline.common.config import load_area, load_remarks
from pipeline.common.parse import index_to_period, period_index
from pipeline.common.paths import INTERIM_DIR, WEB_DATA_DIR, write_json
from pipeline.fetch_transactions import KANSAI_PATH

LOGGER = logging.getLogger(__name__)
OUTPUT_PATH = WEB_DATA_DIR / "region_index.json"
DEFAULT_BASE = "2023Q1"  # 金利が上がる前
SMOOTH_QUARTERS = 4
MIN_WINDOW_N = 40  # 4四半期の合計件数がこれ未満の値は「参考」
MIN_REGION_ROWS = 60
MIN_STATION_ROWS = 80


def prepare(frame: pd.DataFrame) -> pd.DataFrame:
    data = frame.copy()
    for column in ("price_per_sqm", "area_sqm", "age_at_trade"):
        data[column] = pd.to_numeric(data[column], errors="coerce")
    data = data.dropna(subset=["price_per_sqm", "area_sqm", "age_at_trade"])
    data = data.loc[data["price_per_sqm"].gt(0) & data["area_sqm"].between(15, 250) & data["age_at_trade"].ge(-1)]
    data["period"] = data["period"].astype(str)
    data["pidx"] = data["period"].map(period_index)
    data["y"] = np.log(data["price_per_sqm"].astype(float))
    return data


def clean_kansai(frame: pd.DataFrame) -> pd.DataFrame:
    """関西全体の事例に、対象エリアと同じ除外（事情等・外れ値）をかける。"""
    remarks = load_remarks()
    exclude = set(remarks["exclude"])
    data = prepare(frame)
    special = data["remarks"].fillna("").astype(str).map(
        lambda value: any(part in exclude for part in value.split(remarks["separator"])))
    data = data.loc[~special]
    median = data.groupby(["municipality_code", "price_category"])["y"].transform("median")
    mad = (data["y"] - median).abs().groupby([data["municipality_code"], data["price_category"]]).transform("median")
    outlier = mad.gt(0) & ((data["y"] - median).abs() / (1.4826 * mad)).gt(3.5)
    return data.loc[~outlier]


def fit_period_effects(data: pd.DataFrame, fixed_effect: str | None = None) -> dict[int, float]:
    """四半期の効果（ln）。最初の四半期を0とする。fixed_effect の列で平均を引いて固定効果にする。"""
    periods = sorted(data["pidx"].unique())
    if len(periods) < 2:
        return {}
    columns = {f"p{p}": data["pidx"].eq(p).astype(float) for p in periods[1:]}
    age = data["age_at_trade"].astype(float)
    columns.update({
        "age": age, "age2": age**2, "ln_area": np.log(data["area_sqm"].astype(float)),
        "trade": data["price_category"].astype(str).eq("trade").astype(float),
    })
    design = pd.DataFrame(columns, index=data.index)
    target = data["y"].astype(float)
    if fixed_effect:
        groups = data[fixed_effect].astype(str)
        design = design - design.groupby(groups).transform("mean")
        target = target - target.groupby(groups).transform("mean")
    else:
        design.insert(0, "const", 1.0)
    design = design.loc[:, design.abs().sum() > 0]  # 全く変化しない列（例: 取引価格情報がない地域）を除く
    coefficients, *_ = np.linalg.lstsq(design.to_numpy(), target.to_numpy(), rcond=None)
    fitted = dict(zip(design.columns, coefficients))
    effects = {periods[0]: 0.0}
    for p in periods[1:]:
        if f"p{p}" in fitted:
            effects[p] = float(fitted[f"p{p}"])
    return effects


def smooth(log: list[float | None], counts: list[int], window: int = SMOOTH_QUARTERS) -> tuple[list[float | None], list[int]]:
    """直近 window 四半期の、件数で重み付けした平均と、その合計件数。"""
    smoothed: list[float | None] = []
    totals: list[int] = []
    for i in range(len(log)):
        pairs = [(log[j], counts[j]) for j in range(max(0, i - window + 1), i + 1) if log[j] is not None and counts[j] > 0]
        total = sum(n for _, n in pairs)
        totals.append(int(sum(counts[max(0, i - window + 1): i + 1])))
        smoothed.append(round(sum(v * n for v, n in pairs) / total, 5) if total else None)
    return smoothed, totals


def build_series(data: pd.DataFrame, period_range: list[int], fixed_effect: str | None = None) -> dict[str, Any] | None:
    effects = fit_period_effects(data, fixed_effect)
    if not effects:
        return None
    counts_by_period = data.groupby("pidx").size()
    counts = [int(counts_by_period.get(p, 0)) for p in period_range]
    log = [round(effects[p], 5) if p in effects else None for p in period_range]
    smoothed, window_counts = smooth(log, counts)
    return {"log": log, "smooth": smoothed, "n": counts, "n4": window_counts}


def build_region_index() -> dict[str, Any]:
    area = load_area()
    local = prepare(pd.read_csv(INTERIM_DIR / "transactions.csv", dtype={"municipality_code": "string"}, keep_default_na=False))
    local = local.loc[local["excluded_reason"].astype(str).eq("")]
    kansai = clean_kansai(pd.read_csv(KANSAI_PATH, dtype={"municipality_code": "string", "prefecture_code": "string"}, keep_default_na=False))
    first = min(local["pidx"].min(), kansai["pidx"].min())
    last = max(local["pidx"].max(), kansai["pidx"].max())
    period_range = list(range(int(first), int(last) + 1))

    average = build_series(kansai, period_range, fixed_effect="municipality_code")
    if average is None:
        raise ValueError("関西平均の指数を作れませんでした")
    result: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "method": "time_dummy_hedonic_fe",
        "periods": [index_to_period(p) for p in period_range],
        "defaultBase": DEFAULT_BASE,
        "smoothQuarters": SMOOTH_QUARTERS,
        "minWindowN": MIN_WINDOW_N,
        "average": {"id": "kansai", "name": "関西平均（2府4県）", "rows": int(len(kansai)), **average},
        "municipalities": [], "groups": [], "stations": [],
    }
    group_of = {item["code"]: item["group"] for item in area["municipalities"]}
    for item in area["municipalities"]:
        subset = local.loc[local["municipality_code"].astype(str).eq(item["code"])]
        series = build_series(subset, period_range) if len(subset) >= MIN_REGION_ROWS else None
        if series:
            result["municipalities"].append({"id": item["code"], "name": item["name"], "group": item["group"], "rows": int(len(subset)), **series})
    for group_id, name in area["groups"].items():
        codes = [code for code, group in group_of.items() if group == group_id]
        subset = local.loc[local["municipality_code"].astype(str).isin(codes)]
        series = build_series(subset, period_range, fixed_effect="municipality_code") if len(subset) >= MIN_REGION_ROWS else None
        if series:
            result["groups"].append({"id": group_id, "name": name, "rows": int(len(subset)), **series})
    with_station = local.loc[local["nearest_station"].astype(str).str.strip().ne("")]
    for station, subset in with_station.groupby(with_station["nearest_station"].astype(str)):
        if len(subset) < MIN_STATION_ROWS:
            continue
        series = build_series(subset, period_range)
        if series:
            codes = subset["municipality_code"].astype(str).value_counts()
            result["stations"].append({
                "id": station, "name": station, "municipalityCodes": [str(code) for code in codes.index[:3]],
                "rows": int(len(subset)), **series,
            })
    write_json(OUTPUT_PATH, result)
    LOGGER.info("騰落指数: 関西平均 %d件、市区町村 %d、グループ %d、駅 %d",
                len(kansai), len(result["municipalities"]), len(result["groups"]), len(result["stations"]))
    return result


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    build_region_index()


if __name__ == "__main__":
    main()
