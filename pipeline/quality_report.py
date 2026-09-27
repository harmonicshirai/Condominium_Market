from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.common.config import load_area
from pipeline.common.parse import period_index
from pipeline.common.paths import INTERIM_DIR, REPORTS_DIR

LOGGER = logging.getLogger(__name__)
INPUT_PATH = INTERIM_DIR / "transactions.csv"
OUTPUT_PATH = REPORTS_DIR / "quality_report.md"
QUANTILES = (0.05, 0.25, 0.50, 0.75, 0.95)


def municipalities_without_data(input_path: Path = INPUT_PATH) -> list[str]:
    """採用された事例が1件もない対象市区町村（「コード 名前」の一覧）。"""
    frame = pd.read_csv(input_path, dtype={"municipality_code": "string"}, keep_default_na=False)
    accepted = set(frame.loc[frame["excluded_reason"].astype(str).eq(""), "municipality_code"].astype(str))
    return [f"{item['code']} {item['name']}" for item in load_area()["municipalities"] if item["code"] not in accepted]


def build_quality_report(input_path: Path = INPUT_PATH, output_path: Path = OUTPUT_PATH) -> str:
    frame = pd.read_csv(input_path, dtype={"municipality_code": "string"}, keep_default_na=False)
    accepted = frame.loc[frame["excluded_reason"].astype(str).eq("")].copy()
    area = load_area()
    names = {item["code"]: item["name"] for item in area["municipalities"]}
    prefectures = area["prefectures"]

    def count_table(columns: list[str], display_names: dict[str, str] | None = None) -> str:
        if accepted.empty:
            return "該当データはありません。"
        table = accepted.groupby(columns, dropna=False).size().rename("件数").reset_index()
        if display_names:
            column = columns[0]
            table[column] = table[column].astype(str).map(display_names).fillna(table[column].astype(str))
        return table.to_markdown(index=False)

    lines = [
        "# 取引データ品質レポート",
        "",
        f"- 全行: {len(frame):,}件",
        f"- 採用: {len(accepted):,}件",
        f"- 除外: {len(frame) - len(accepted):,}件",
        "",
        "## 区分別",
        count_table(["price_category"]),
        "",
        "## 府県別",
    ]
    if accepted.empty:
        lines.append("該当データはありません。")
    else:
        by_pref = accepted["municipality_code"].astype(str).str[:2].value_counts()
        lines.extend(["| 府県 | 件数 |", "|---|---:|"])
        lines.extend(f"| {name} | {int(by_pref.get(code, 0)):,} |" for code, name in prefectures.items())
    lines.extend(["", "## 市区町村別", "| 市区町村 | 成約 | 取引 |", "|---|---:|---:|"])
    by_code = accepted.groupby(["municipality_code", "price_category"]).size() if not accepted.empty else pd.Series(dtype=int)
    for code, name in names.items():
        contract_count = int(by_code.get((code, "contract"), 0))
        trade_count = int(by_code.get((code, "trade"), 0))
        note = "（データなし）" if contract_count + trade_count == 0 else ""
        lines.append(f"| {code} {name}{note} | {contract_count:,} | {trade_count:,} |")
    lines.extend(["", "## 四半期別", count_table(["period"]), "", "## 項目別の欠損率"])

    missing_columns = ["district", "building_year", "floor_plan", "renovation", "nearest_station", "walk_minutes"]
    missing_lines = ["| 項目 | 欠損件数 | 欠損率 |"]
    missing_lines.append("|---|---:|---:|")
    for column in missing_columns:
        values = accepted[column] if column in accepted else pd.Series([""] * len(accepted))
        missing = values.isna() | values.astype(str).str.strip().isin(["", "unknown"])
        rate = float(missing.mean()) if len(accepted) else 0.0
        missing_lines.append(f"| {column} | {int(missing.sum()):,} | {rate:.1%} |")
    lines.extend(missing_lines)
    lines.extend(["", "## 改装の区分（成約価格情報は「改装済み」か空欄のみ）", "| 区分 | renovated | not_renovated | unknown |", "|---|---:|---:|---:|"])
    for category in ("contract", "trade"):
        subset = accepted.loc[accepted["price_category"].eq(category), "renovation"].astype(str) if not accepted.empty else pd.Series(dtype=str)
        counts = subset.value_counts()
        lines.append(f"| {category} | " + " | ".join(f"{int(counts.get(key, 0)):,}" for key in ("renovated", "not_renovated", "unknown")) + " |")
    lines.extend(["", "## 主要項目の分布（採用分）", "| 区分 | 項目 | 5% | 25% | 50% | 75% | 95% |", "|---|---|---:|---:|---:|---:|---:|"])
    for category in ("contract", "trade"):
        subset = accepted.loc[accepted["price_category"].eq(category)]
        for column in ("price_per_sqm", "area_sqm", "age_at_trade"):
            values = pd.to_numeric(subset[column], errors="coerce").dropna() if column in subset else pd.Series(dtype=float)
            if values.empty:
                quantile_values = ["—"] * len(QUANTILES)
            else:
                quantile_values = [f"{value:,.1f}" for value in np.quantile(values, QUANTILES)]
            lines.append(f"| {category} | {column} | " + " | ".join(quantile_values) + " |")
    lines.extend(["", "## 除外理由", "| 理由 | 件数 |", "|---|---:|"])
    excluded = frame.loc[frame["excluded_reason"].astype(str).ne("")]
    if excluded.empty:
        lines.append("| なし | 0 |")
    else:
        for reason, count in excluded["excluded_reason"].value_counts().items():
            lines.append(f"| {reason} | {int(count):,} |")

    lines.extend(["", "## 取引の事情等（除外前の件数）", "| 値 | 件数 |", "|---|---:|"])
    remarks = frame["remarks"].astype(str).str.strip() if "remarks" in frame else pd.Series(dtype=str)
    remark_counts = remarks.loc[remarks.ne("")].value_counts()
    if remark_counts.empty:
        lines.append("| なし | 0 |")
    else:
        for value, count in remark_counts.items():
            lines.append(f"| {value} | {int(count):,} |")
    special = int(frame["excluded_reason"].astype(str).eq("special_circumstances").sum())
    lines.append(f"\n事情等により除外した件数: {special:,}件")

    contract = accepted.loc[accepted["price_category"].eq("contract")]
    low_volume: list[str] = []
    if not contract.empty:
        period_values = contract["period"].astype(str).tolist()
        latest = max(period_index(value) for value in period_values)
        recent = contract.loc[contract["period"].map(period_index).ge(latest - 7)]
        totals = recent.groupby("municipality_code").size()
        for code, name in names.items():
            count = int(totals.get(code, 0))
            if count < 30:
                low_volume.append(f"{code} {name}（{count}件{'・データなし' if count == 0 else ''}）")
    else:
        low_volume = [f"{code} {name}（0件・データなし）" for code, name in names.items()]
    lines.extend(["", "## 直近8四半期の成約件数が30件未満"])
    if low_volume:
        lines.extend(f"- {item}" for item in low_volume)
    else:
        lines.append("該当データはありません。")
    report = "\n".join(lines) + "\n"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8", newline="\n")
    LOGGER.info("品質レポートを書き出しました: %s", output_path)
    return report


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    build_quality_report()


if __name__ == "__main__":
    main()
