from __future__ import annotations

import pandas as pd
import pytest

from pipeline.build_hazard_codes import read_depth_codes
from pipeline.hazard_depth import parse_depth_range


@pytest.mark.parametrize(("text", "expected"), [
    ("0～0.5m未満", (0.0, 0.5)),
    ("0.5～3.0m未満", (0.5, 3.0)),
    ("20.0m以上", (20.0, None)),
    ("5m以上10m未満", (5.0, 10.0)),
    ("3m以上 〜 5m未満", (3.0, 5.0)),
    ("0.3m未満", (0.0, 0.3)),
])
def test_parse_depth_range(text: str, expected: tuple[float, float | None]) -> None:
    assert parse_depth_range(text) == expected


def test_parse_depth_range_rejects_unknown_text() -> None:
    with pytest.raises(ValueError):
        parse_depth_range("浸水なし")


def test_read_depth_codes_from_code_list_layout() -> None:
    frame = pd.DataFrame([
        ["浸水ランクコード", None, None],
        ["コード", "定義", "内容"],
        [1, "0～0.5m未満", "一般的な住宅において床下程度の浸水"],
        [2, "0.5～3.0m未満", "床上から1階が浸水"],
        [6, "20.0m以上", None],
    ])
    codes = read_depth_codes(frame)
    assert codes["2"] == {"label": "0.5～3.0m未満（床上から1階が浸水）", "minM": 0.5, "maxM": 3.0}
    assert codes["6"] == {"label": "20.0m以上", "minM": 20.0, "maxM": None}


def test_parse_tsunami_range_without_suffix() -> None:
    assert parse_depth_range("0.01～0.3m") == (0.01, 0.3)
    assert parse_depth_range("4.0～5.0m") == (4.0, 5.0)
    assert parse_depth_range("5.0m～") == (5.0, None)


def test_polygon_mask_and_rle_roundtrip() -> None:
    import numpy as np
    from pipeline.hazard_grid import decode_rle, encode_rle, lonlat_to_tile_fraction, polygon_mask, rasterize

    x, y, z = 14355, 6505, 14
    # タイルの左上 1/4 を覆う正方形（経緯度に戻して作る）
    def lonlat(fx: float, fy: float) -> list[float]:
        import math
        n = 2**z
        lon = fx / n * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * fy / n))))
        return [lon, lat]
    square = [[lonlat(x, y), lonlat(x + 0.5, y), lonlat(x + 0.5, y + 0.5), lonlat(x, y + 0.5), lonlat(x, y)]]
    mask = polygon_mask(square, "Polygon", x, y, z, size=8)
    assert mask[:4, :4].all() and not mask[4:, :].any() and not mask[:, 4:].any()
    fx, fy = lonlat_to_tile_fraction(*lonlat(x + 0.25, y + 0.25), z)
    assert (fx - x, fy - y) == pytest.approx((0.25, 0.25))

    features = [
        {"geometry": {"type": "Polygon", "coordinates": square}, "properties": {"v": 2}},
        {"geometry": {"type": "Polygon", "coordinates": [[lonlat(x, y), lonlat(x + 0.25, y), lonlat(x + 0.25, y + 0.25), lonlat(x, y + 0.25), lonlat(x, y)]]}, "properties": {"v": 5}},
    ]
    grid = rasterize(features, lambda props: props["v"], "max", x, y, z, size=8)
    assert grid[0, 0] == 5 and grid[3, 3] == 2 and grid[7, 7] == 0
    assert np.array_equal(decode_rle(encode_rle(grid), size=8), grid)


def test_encode_depth_orders_by_depth() -> None:
    from pipeline.fetch_hazard import _landslide_value, encode_depth
    assert encode_depth(0.5, 3.0) == 50030
    assert encode_depth(20.0, None) == 2000999
    assert encode_depth(3.0, 5.0) > encode_depth(0.5, 3.0)
    assert _landslide_value({"A33_001": 2, "A33_002": 2}) == 2 | 8
    assert _landslide_value({"A33_001": 1, "A33_002": 1}) == 1
