from __future__ import annotations

import pandas as pd
import pytest

from pipeline.normalize import normalize_transactions


def _row(row_id: str, price: int | str, area: int | str = 70, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "id": row_id,
        "price_category": "contract",
        "municipality_code": "28202",
        "municipality": "尼崎市",
        "period": "2024Q1",
        "price_yen": price,
        "area_sqm": area,
        "area_capped": False,
        "price_per_sqm": (float(price) / float(area)) if price not in ("", 0) and area not in ("", 0) else "",
        "building_year": 2000,
        "prewar": False,
        "age_at_trade": 24,
        "seismic": "new",
        "floor_plan": "3LDK",
        "structure": "RC",
        "renovation": "unknown",
        "nearest_station": "尼崎",
        "walk_minutes": 5,
        "walk_capped": False,
        "remarks": "",
        "source": "csv",
        "excluded_reason": "",
    }
    row.update(overrides)
    return row


def test_normalize_marks_each_exclusion_reason(tmp_path) -> None:
    records = [
        _row("price", ""),
        _row("area", 1, ""),
        _row("capped", 7_000_000, 70, area_capped=True),
        _row("range", 1_000_000, 10),
        _row("period", 7_000_000, 70, period=""),
        _row("building", 7_000_000, 70, age_at_trade=-2),
        _row("normal-1", 7_000_000, 70),
        _row("normal-2", 7_700_000, 70),
        _row("normal-3", 6_300_000, 70),
        _row("normal-4", 7_350_000, 70),
        _row("outlier", 70_000_000, 70),
    ]
    source = tmp_path / "transactions_csv.csv"
    pd.DataFrame(records).to_csv(source, index=False)

    output = normalize_transactions(source, tmp_path / "missing-api.csv", tmp_path / "normalized.csv")

    reasons = dict(zip(output["id"], output["excluded_reason"], strict=True))
    assert reasons["price"] == "price_missing"
    assert reasons["area"] == "area_missing"
    assert reasons["capped"] == "area_capped"
    assert reasons["range"] == "area_out_of_range"
    assert reasons["period"] == "period_missing"
    assert reasons["building"] == "building_after_trade"
    assert reasons["outlier"] == "ppsqm_outlier"


def test_csv_source_takes_priority_for_same_period_key(tmp_path) -> None:
    csv_path = tmp_path / "transactions_csv.csv"
    api_path = tmp_path / "transactions_api.csv"
    pd.DataFrame([_row("from-csv", 7_000_000)]).to_csv(csv_path, index=False)
    pd.DataFrame([_row("from-api", 8_000_000, source="api")]).to_csv(api_path, index=False)

    result = normalize_transactions(csv_path, api_path, tmp_path / "normalized.csv")

    assert result["id"].tolist() == ["from-csv"]


def test_api_is_kept_when_csv_has_no_matching_key(tmp_path) -> None:
    csv_path = tmp_path / "transactions_csv.csv"
    api_path = tmp_path / "transactions_api.csv"
    pd.DataFrame([_row("from-csv", 7_000_000)]).to_csv(csv_path, index=False)
    pd.DataFrame([_row("from-api", 8_000_000, period="2024Q2", source="api")]).to_csv(api_path, index=False)

    result = normalize_transactions(csv_path, api_path, tmp_path / "normalized.csv")

    assert set(result["id"]) == {"from-csv", "from-api"}


REMARKS = {
    "separator": "、",
    "exclude": ["調停・競売等", "関係者間取引", "瑕疵有りの可能性", "その他事情有り", "隣地の購入"],
    "keep": ["私道を含む取引"],
    "confirmedAt": "2026-09-25",
}


def _normalize(tmp_path, records):
    source = tmp_path / "transactions_csv.csv"
    pd.DataFrame(records).to_csv(source, index=False)
    return normalize_transactions(source, tmp_path / "missing-api.csv", tmp_path / "normalized.csv", REMARKS)


def test_special_circumstances_are_excluded(tmp_path) -> None:
    normal = [_row(f"normal-{i}", 7_000_000 + i * 100_000) for i in range(4)]
    output = _normalize(tmp_path, normal + [
        _row("auction", 7_000_000, remarks="調停・競売等"),
        _row("private-road", 7_000_000, remarks="私道を含む取引"),
        _row("both", 7_000_000, remarks="調停・競売等、私道を含む取引"),
        _row("related", 7_000_000, remarks="関係者間取引"),
    ])
    reasons = dict(zip(output["id"], output["excluded_reason"], strict=True))
    assert reasons["auction"] == "special_circumstances"
    assert reasons["private-road"] == ""
    assert reasons["both"] == "special_circumstances"
    assert reasons["related"] == "special_circumstances"


def test_unknown_remarks_value_stops(tmp_path) -> None:
    with pytest.raises(ValueError, match="未知の値|remarks.json にない"):
        _normalize(tmp_path, [_row("odd", 7_000_000, remarks="新しい事情")])


def test_earlier_reason_wins_over_special_circumstances(tmp_path) -> None:
    output = _normalize(tmp_path, [_row("bad", "", remarks="調停・競売等")])
    assert output["excluded_reason"].tolist() == ["price_missing"]


def test_missing_remarks_column_asks_for_reimport(tmp_path) -> None:
    record = _row("old", 7_000_000)
    del record["remarks"]
    with pytest.raises(ValueError, match="import_csv"):
        _normalize(tmp_path, [record])


def test_quality_report_lists_municipalities_without_data(tmp_path, monkeypatch) -> None:
    from pipeline import quality_report

    output = _normalize(tmp_path, [_row(f"n-{i}", 7_000_000 + i * 10_000, renovation="unknown") for i in range(3)])
    normalized = tmp_path / "normalized.csv"
    assert len(output) == 3
    report = quality_report.build_quality_report(normalized, tmp_path / "report.md")
    low = report.split("## 直近8四半期の成約件数が30件未満")[1]
    assert "28202 尼崎市（3件）" in low
    assert "27207 高槻市（0件・データなし）" in low
    assert "| renovation | 3 | 100.0% |" in report
    assert "27207" in "".join(quality_report.municipalities_without_data(normalized))
    assert all("28202" not in item for item in quality_report.municipalities_without_data(normalized))
