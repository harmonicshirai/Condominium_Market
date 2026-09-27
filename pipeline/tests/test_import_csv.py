from __future__ import annotations

import csv
from pathlib import Path

import pytest

from pipeline.import_csv import OUTPUT_FIELDS, find_missing_periods, import_csv


HEADERS = [
    "種類",
    "価格情報区分",
    "市区町村コード",
    "市区町村名",
    "地区名",
    "最寄駅：名称",
    "最寄駅：距離（分）",
    "取引価格（総額）",
    "面積（㎡）",
    "間取り",
    "建築年",
    "建物の構造",
    "取引時期",
    "改装",
]


def _write_csv(path: Path, rows: list[list[str]]) -> None:
    with path.open("w", encoding="cp932", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(HEADERS)
        writer.writerows(rows)


def test_import_csv_converts_cp932_and_filters_rows(tmp_path: Path) -> None:
    source_dir = tmp_path / "manual_csv"
    source_dir.mkdir()
    _write_csv(
        source_dir / "sample.csv",
        [
            ["中古マンション等", "成約価格情報", "27207", "高槻市", "駅前", "高槻", "5分", "35,000,000", "70", "3LDK", "平成23年", "RC", "2024年第3四半期", "改装済"],
            ["中古マンション等", "不動産取引価格情報", "28202", "尼崎市", "中央", "尼崎", "2H〜", "20,000,000", "60", "2LDK", "昭和56年", "RC", "2024年第4四半期", "未改装"],
            ["中古マンション等", "成約価格情報", "99999", "対象外市", "", "", "", "20,000,000", "60", "2LDK", "2000年", "RC", "2024年第1四半期", ""],
            ["宅地(土地)", "成約価格情報", "27207", "高槻市", "", "", "", "20,000,000", "60", "", "2000年", "", "2024年第1四半期", ""],
        ],
    )
    output_path = tmp_path / "interim" / "transactions_csv.csv"

    result = import_csv(source_dir, output_path)

    assert len(result) == 2
    assert result[0]["period"] == "2024Q3"
    assert result[0]["price_yen"] == 35_000_000
    assert result[0]["area_sqm"] == 70.0
    assert result[0]["price_per_sqm"] == 500_000
    assert result[0]["building_year"] == 2011
    assert result[0]["seismic"] == "new"
    assert result[0]["renovation"] == "renovated"
    assert result[0]["walk_minutes"] == 5
    assert result[1]["price_category"] == "trade"
    assert result[1]["seismic"] == "unknown"
    assert result[1]["walk_capped"] is True
    with output_path.open(encoding="utf-8", newline="") as file:
        assert next(csv.DictReader(file)).keys() == set(OUTPUT_FIELDS)


def test_import_csv_rejects_city_name_mismatch(tmp_path: Path) -> None:
    source_dir = tmp_path / "manual_csv"
    source_dir.mkdir()
    _write_csv(
        source_dir / "bad.csv",
        [["中古マンション等", "成約価格情報", "27207", "別の市", "", "", "", "1", "1", "", "2000年", "", "2024年第1四半期", ""]],
    )

    with pytest.raises(ValueError, match="一致しません"):
        import_csv(source_dir, tmp_path / "output.csv")


def test_import_csv_accepts_confirmed_otsu_name_alias(tmp_path: Path) -> None:
    source_dir = tmp_path / "manual_csv"
    source_dir.mkdir()
    _write_csv(
        source_dir / "alias.csv",
        [["中古マンション等", "成約価格情報", "26303", "乙訓郡大山崎町", "", "", "", "1", "1", "", "2000年", "", "2024年第1四半期", ""]],
    )

    result = import_csv(source_dir, tmp_path / "output.csv")

    assert len(result) == 1
    assert result[0]["municipality"] == "大山崎町"


def test_import_csv_reports_missing_source_directory(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="CSV がありません"):
        import_csv(tmp_path / "empty", tmp_path / "output.csv")


def _mansion(category: str, period: str, code: str = "28202", name: str = "尼崎市") -> list[str]:
    return ["中古マンション等", category, code, name, "中央", "尼崎", "5", "20,000,000", "60", "2LDK", "2000年", "RC", period, ""]


def test_same_category_prefecture_period_in_two_files_stops(tmp_path: Path) -> None:
    source_dir = tmp_path / "manual_csv"
    source_dir.mkdir()
    _write_csv(source_dir / "a.csv", [_mansion("成約価格情報", "2024年第1四半期")])
    _write_csv(source_dir / "b.csv", [_mansion("成約価格情報", "2024年第1四半期")])

    with pytest.raises(ValueError, match="複数のファイル"):
        import_csv(source_dir, tmp_path / "output.csv")


def test_different_category_in_same_period_is_allowed(tmp_path: Path) -> None:
    source_dir = tmp_path / "manual_csv"
    source_dir.mkdir()
    _write_csv(source_dir / "contract.csv", [_mansion("成約価格情報", "2024年第1四半期")])
    _write_csv(source_dir / "trade.csv", [_mansion("不動産取引価格情報", "2024年第1四半期")])

    result = import_csv(source_dir, tmp_path / "output.csv")

    assert sorted(row["price_category"] for row in result) == ["contract", "trade"]


def test_file_without_target_rows_is_skipped(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    source_dir = tmp_path / "manual_csv"
    source_dir.mkdir()
    _write_csv(source_dir / "mansion.csv", [_mansion("成約価格情報", "2024年第1四半期")])
    land = _mansion("成約価格情報", "2024年第1四半期")
    land[0] = "宅地(土地と建物)"
    _write_csv(source_dir / "land.csv", [land])

    with caplog.at_level("WARNING"):
        result = import_csv(source_dir, tmp_path / "output.csv")

    assert len(result) == 1
    assert "land.csv" in caplog.text


def test_rows_before_period_from_are_not_imported(tmp_path: Path) -> None:
    source_dir = tmp_path / "manual_csv"
    source_dir.mkdir()
    _write_csv(source_dir / "old.csv", [
        _mansion("不動産取引価格情報", "2020年第4四半期"),
        _mansion("不動産取引価格情報", "2021年第1四半期"),
    ])

    result = import_csv(source_dir, tmp_path / "output.csv")

    assert [row["period"] for row in result] == ["2021Q1"]


def test_find_missing_periods_lists_gaps_per_prefecture_and_category() -> None:
    imported = [
        {"municipality_code": "28202", "price_category": "contract", "period": "2021Q1"},
        {"municipality_code": "28202", "price_category": "contract", "period": "2021Q3"},
    ]

    missing = find_missing_periods(imported, {"27": "大阪府", "28": "兵庫県"})

    assert missing[("28", "contract")] == ["2021Q2"]
    assert missing[("28", "trade")] == ["2021Q1", "2021Q2", "2021Q3"]
    assert missing[("27", "contract")] == ["2021Q1", "2021Q2", "2021Q3"]
