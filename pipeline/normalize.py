from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.common.config import RemarksConfig, load_remarks
from pipeline.common.paths import INTERIM_DIR

LOGGER = logging.getLogger(__name__)
CSV_PATH = INTERIM_DIR / "transactions_csv.csv"
API_PATH = INTERIM_DIR / "transactions_api.csv"
OUTPUT_PATH = INTERIM_DIR / "transactions.csv"
KEY_COLUMNS = ["price_category", "municipality_code", "period"]


def _read_transactions(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, dtype={"municipality_code": "string"}, keep_default_na=False)
    if "municipality_code" in frame:
        frame["municipality_code"] = frame["municipality_code"].astype("string").str.zfill(5)
    if "excluded_reason" not in frame:
        frame["excluded_reason"] = ""
    if "source" not in frame:
        frame["source"] = "csv" if path.name == CSV_PATH.name else "api"
    return frame


def special_circumstance_mask(remarks: pd.Series, config: RemarksConfig) -> pd.Series:
    """取引の事情等に除外対象の値が1つでもあれば True。設定にない値があれば例外。"""
    exclude = set(config["exclude"])
    known = exclude | set(config["keep"])
    unknown: dict[str, int] = {}
    flags: list[bool] = []
    for value in remarks.fillna("").astype(str):
        parts = [part.strip() for part in value.split(config["separator"]) if part.strip()]
        for part in parts:
            if part not in known:
                unknown[part] = unknown.get(part, 0) + 1
        flags.append(any(part in exclude for part in parts))
    if unknown:
        listing = "、".join(f"{value}（{count}件）" for value, count in sorted(unknown.items()))
        raise ValueError(
            f"config/remarks.json にない「取引の事情等」の値があります: {listing}。"
            "除外するか残すかを決めて remarks.json に追加してください"
        )
    return pd.Series(flags, index=remarks.index)


def normalize_transactions(
    csv_path: Path = CSV_PATH,
    api_path: Path = API_PATH,
    output_path: Path = OUTPUT_PATH,
    remarks_config: RemarksConfig | None = None,
) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    if csv_path.exists():
        frames.append(_read_transactions(csv_path))
    if api_path.exists():
        frames.append(_read_transactions(api_path))
    if not frames:
        raise FileNotFoundError("transactions_csv.csv がありません。先に import_csv を実行してください")

    for frame in frames:
        if "remarks" not in frame:
            if frame["source"].eq("csv").any():
                raise ValueError(
                    "transactions_csv.csv に remarks 列がありません。"
                    "先に python -m pipeline.import_csv を実行し直してください"
                )
            frame["remarks"] = ""
    combined = pd.concat(frames, ignore_index=True)
    combined["source"] = combined["source"].astype(str)
    csv_keys = combined.loc[combined["source"] == "csv", KEY_COLUMNS].drop_duplicates()
    if not csv_keys.empty:
        api_rows = combined["source"] == "api"
        api_multi = combined.loc[api_rows].merge(
            csv_keys.assign(_has_csv=True), on=KEY_COLUMNS, how="left"
        )
        retained_api = api_multi.loc[api_multi["_has_csv"].isna(), combined.columns]
        combined = pd.concat(
            [combined.loc[~api_rows], retained_api], ignore_index=True
        )

    combined["excluded_reason"] = ""
    price = pd.to_numeric(combined.get("price_yen"), errors="coerce")
    area = pd.to_numeric(combined.get("area_sqm"), errors="coerce")
    ppsqm = pd.to_numeric(combined.get("price_per_sqm"), errors="coerce")
    ppsqm = ppsqm.where(ppsqm.notna(), price / area)
    combined["price_per_sqm"] = ppsqm

    def exclude(mask: pd.Series, reason: str) -> None:
        combined.loc[combined["excluded_reason"].eq("") & mask.fillna(False), "excluded_reason"] = reason

    exclude(price.isna() | price.le(0), "price_missing")
    exclude(area.isna() | area.le(0), "area_missing")
    if "area_capped" not in combined:
        combined["area_capped"] = False
    capped = combined["area_capped"].map(
        lambda value: value is True or str(value).strip().lower() in {"true", "1", "yes"}
    )
    exclude(capped, "area_capped")
    exclude(area.lt(15) | area.gt(250), "area_out_of_range")
    exclude(combined["period"].astype(str).str.strip().eq(""), "period_missing")
    if "age_at_trade" not in combined:
        combined["age_at_trade"] = ""
    age = pd.to_numeric(combined["age_at_trade"], errors="coerce")
    exclude(age.lt(-1), "building_after_trade")
    exclude(special_circumstance_mask(combined["remarks"], remarks_config or load_remarks()), "special_circumstances")

    eligible = combined["excluded_reason"].eq("") & ppsqm.gt(0)
    for _, indices in combined.loc[eligible].groupby(["municipality_code", "price_category"]).groups.items():
        values = np.log(ppsqm.loc[indices].astype(float).to_numpy())
        median = float(np.median(values))
        mad = float(np.median(np.abs(values - median)))
        if mad == 0:
            continue
        outliers = np.abs(values - median) / (1.4826 * mad) > 3.5
        if outliers.any():
            exclude(pd.Series(combined.index.isin(np.asarray(indices)[outliers]), index=combined.index), "ppsqm_outlier")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(output_path, index=False, encoding="utf-8", lineterminator="\n")
    LOGGER.info("正規化: %d行（採用 %d / 除外 %d）", len(combined), int(combined["excluded_reason"].eq("").sum()), int(combined["excluded_reason"].ne("").sum()))
    return combined


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    normalize_transactions()


if __name__ == "__main__":
    main()
