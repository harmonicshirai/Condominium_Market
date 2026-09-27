import json
from pathlib import Path

import pytest

from pipeline.common import config


def test_load_area_and_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "AREA_PATH", config.CONFIG_DIR / "area.json")
    area = config.load_area()
    codes = config.municipality_codes()

    assert len(area["municipalities"]) == 28
    assert "26104" in codes
    assert "28202" in codes
    assert config.group_of("28202") == "hanshin"
    assert config.group_of("26104") == "kyoto_center"


@pytest.mark.parametrize(
    ("case", "message"),
    [
        ("short_code", "5桁"),
        ("duplicate_code", "重複"),
        ("unknown_group", "group"),
        ("unknown_prefecture", "都道府県"),
    ],
)
def test_load_area_rejects_invalid_municipality(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    case: str,
    message: str,
) -> None:
    area = config.load_area()
    if case == "short_code":
        area["municipalities"][0]["code"] = "2610"
    elif case == "duplicate_code":
        area["municipalities"].append(area["municipalities"][0].copy())
    elif case == "unknown_group":
        area["municipalities"][0]["group"] = "missing"
    else:
        area["municipalities"][0]["code"] = "29104"
    path = tmp_path / "area.json"
    path.write_text(json.dumps(area, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(config, "AREA_PATH", path)

    with pytest.raises(ValueError, match=message):
        config.load_area()


def test_group_of_rejects_unknown_code() -> None:
    with pytest.raises(KeyError, match="設定にありません"):
        config.group_of("99999")


def test_load_credits() -> None:
    sources = config.load_credits()

    ids = {source["id"] for source in sources}
    # API 利用規約の表示と、画面で使うデータの出典がそろっていること
    assert {"reinfolib_api", "reinfolib_prices", "disaportal", "gsi_tiles",
            "ksj_stations", "disaportal_hazard", "ksj_landslide"} <= ids
    assert len(ids) == len(sources)
    assert all(source["credit"].strip() for source in sources)


def test_load_credits_rejects_empty_credit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "credits.json"
    path.write_text(json.dumps({"sources": [{"credit": "  "}]}), encoding="utf-8")
    monkeypatch.setattr(config, "CREDITS_PATH", path)

    with pytest.raises(ValueError, match="credit は空"):
        config.load_credits()
