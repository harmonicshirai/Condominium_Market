from __future__ import annotations

import pandas as pd
import pytest

from pipeline.fetch_stations import feature_point, merge_stations, normalize_station_name, station_market


def _feature(name: str, coords: object, kind: str = "LineString", **props: object) -> dict[str, object]:
    return {"type": "Feature", "geometry": {"type": kind, "coordinates": coords},
            "properties": {"S12_001_ja": name, "S12_001c": "001", "S12_002_ja": "阪神電気鉄道", "S12_003_ja": "本線", **props}}


def test_feature_point_averages_vertices() -> None:
    assert feature_point({"type": "Point", "coordinates": [135.4, 34.7]}) == (135.4, 34.7)
    assert feature_point({"type": "LineString", "coordinates": [[135.0, 34.0], [135.2, 34.2]]}) == pytest.approx((135.1, 34.1))
    assert feature_point({"type": "MultiLineString", "coordinates": [[[135.0, 34.0]], [[135.4, 34.4]]]}) == pytest.approx((135.2, 34.2))
    assert feature_point({"type": "Polygon", "coordinates": []}) is None


def test_merge_stations_across_tiles() -> None:
    stations = merge_stations([
        _feature("尼崎", [[135.40, 34.72], [135.42, 34.72]], S12_057=40962),
        _feature("尼崎", [[135.42, 34.72], [135.44, 34.72]]),
        _feature("出屋敷", [135.41, 34.71], kind="Point"),
    ])
    assert [s["name"] for s in stations] == ["出屋敷", "尼崎"]
    amagasaki = stations[1]
    assert amagasaki["lon"] == pytest.approx(135.42)
    assert amagasaki["passengers"] == 40962


def test_normalize_station_name() -> None:
    assert normalize_station_name("尼崎駅") == "尼崎"
    assert normalize_station_name("霞ヶ丘") == "霞ケ丘"
    assert normalize_station_name("ＪＲ尼崎") == "JR尼崎"


def test_station_market_uses_recent_contracts_with_enough_samples() -> None:
    rows = []
    for i in range(6):
        rows.append({"excluded_reason": "", "price_category": "contract", "nearest_station": "尼崎", "period": "2026Q1", "price_per_sqm": 400_000 + i})
    rows.append({"excluded_reason": "", "price_category": "contract", "nearest_station": "尼崎", "period": "2023Q1", "price_per_sqm": 1})  # 古い
    rows.append({"excluded_reason": "", "price_category": "trade", "nearest_station": "尼崎", "period": "2026Q1", "price_per_sqm": 1})
    rows.extend({"excluded_reason": "", "price_category": "contract", "nearest_station": "立花", "period": "2026Q1", "price_per_sqm": 1} for _ in range(4))
    market = station_market(pd.DataFrame(rows))
    assert set(market) == {"尼崎"}
    assert market["尼崎"]["n"] == 6
    assert market["尼崎"]["medianPricePerSqm"] == 400_002 or market["尼崎"]["medianPricePerSqm"] == 400_003


def test_market_matches_operator_and_region_qualifiers() -> None:
    from pipeline.fetch_stations import match_market, split_station_name
    assert split_station_name("尼崎(JR)") == ("尼崎", "JR")
    assert split_station_name("高槻") == ("高槻", None)
    market = {"尼崎(JR)": {"n": 1}, "尼崎(阪神)": {"n": 2}, "大宮(京都)": {"n": 3}, "高槻": {"n": 4}}
    assert match_market({"name": "尼崎", "operator": "西日本旅客鉄道"}, market) == {"n": 1}
    assert match_market({"name": "尼崎", "operator": "阪神電気鉄道"}, market) == {"n": 2}
    assert match_market({"name": "尼崎", "operator": "阪急電鉄"}, market) is None
    assert match_market({"name": "大宮", "operator": "阪急電鉄"}, market) == {"n": 3}
    assert match_market({"name": "高槻", "operator": "西日本旅客鉄道"}, market) == {"n": 4}
