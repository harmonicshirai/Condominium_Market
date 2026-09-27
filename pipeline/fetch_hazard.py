"""ハザード（洪水・高潮・津波・土砂災害）を z=14 タイルごとの格子にして保存する（python -m pipeline.fetch_hazard）。

区域の形（1タイル1MB超）ではなく、128×128 マス（1マス約16m）の値をランレングス圧縮して配る（hazard_grid.py）。
出力: web/public/data/hazard/{layer}/index.json と 14/{x}/{y}.json（区域があるタイルだけ）

マスの値:
- flood: 浸水深ランク（A31a_205。コード表は hazard_codes.json）。重なりは最大
- storm_surge / tsunami: encode_depth(下限m, 上限m)。重なりは最大（＝最も深い区分）
- landslide: ビット和（1=急傾斜地の崩壊, 2=土石流, 4=地滑り, 8=特別警戒区域）
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from pipeline.common.config import load_area
from pipeline.common.paths import CONFIG_DIR, RAW_DIR, ROOT, WEB_DATA_DIR, load_json, write_json
from pipeline.common.tiles import tiles_in_bbox
from pipeline.hazard_depth import parse_depth_range
from pipeline.hazard_grid import GRID_SIZE, encode_rle, rasterize
from pipeline.reinfolib.client import ReinfolibClient

LOGGER = logging.getLogger(__name__)
ZOOM = 14
LOCAL_LISTINGS_PATH = ROOT / "web" / "public" / "local-data" / "listings.json"
LOCAL_BUFFER_KM = 0.3
LANDSLIDE_TYPE_BITS = {1: 1, 2: 2, 3: 4}
LANDSLIDE_SPECIAL_BIT = 8
LANDSLIDE_SPECIAL_ZONES = {2, 4}  # 特別警戒区域（指定済・指定前）


def encode_depth(min_m: float, max_m: float | None) -> int:
    """下限の cm ×1000 ＋ 上限の 0.1m 単位（上限なしは999）。大きいほど深い区分。"""
    return int(round(min_m * 100)) * 1000 + (999 if max_m is None else int(round(max_m * 10)))


def _flood_value(props: dict[str, Any]) -> int:
    return int(props["A31a_205"])


def _depth_value(field: str):
    def value(props: dict[str, Any]) -> int:
        return encode_depth(*parse_depth_range(str(props[field])))
    return value


def _landslide_value(props: dict[str, Any]) -> int:
    bits = LANDSLIDE_TYPE_BITS.get(int(props["A33_001"]), 0)
    if int(props["A33_002"]) in LANDSLIDE_SPECIAL_ZONES:
        bits |= LANDSLIDE_SPECIAL_BIT
    return bits


# レイヤー名: (API, マスの値, 重なりのまとめ方, 表示用の文字列を拾う項目)
LAYERS: dict[str, tuple[str, Any, str, str | None]] = {
    "flood": ("XKT026", _flood_value, "max", None),
    "storm_surge": ("XKT027", _depth_value("A49_003"), "max", "A49_003"),
    "tsunami": ("XKT028", _depth_value("A40_003"), "max", "A40_003"),
    "landslide": ("XKT029", _landslide_value, "or", None),
}


def buffer_bbox(lat: float, lon: float, km: float) -> tuple[float, float, float, float]:
    dlat = km / 111.0
    dlon = km / (111.0 * math.cos(math.radians(lat)))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat


def tiles_around(points: list[tuple[float, float]], km: float, z: int = ZOOM) -> list[tuple[int, int]]:
    """(緯度, 経度) の各点から km 以内に入るタイル（重複なし）。"""
    tiles: set[tuple[int, int]] = set()
    for lat, lon in points:
        west, south, east, north = buffer_bbox(lat, lon, km)
        tiles.update(tiles_in_bbox(west, south, east, north, z))
    return sorted(tiles)


def target_station_points() -> list[tuple[float, float]]:
    path = WEB_DATA_DIR / "stations.json"
    if not path.exists():
        raise FileNotFoundError("stations.json がありません。先に python -m pipeline.fetch_stations を実行してください")
    return [(item["lat"], item["lon"]) for item in load_json(path) if item.get("isTargetLine")]


def local_listing_points() -> list[tuple[float, float]]:
    if not LOCAL_LISTINGS_PATH.exists():
        raise FileNotFoundError("手元の掲載物件データ（web/public/local-data/listings.json）がありません")
    return [(item["lat"], item["lon"]) for item in load_json(LOCAL_LISTINGS_PATH)
            if item.get("lat") is not None and item.get("lon") is not None]


def fetch_hazard(tiles: list[tuple[int, int]], layers: list[str], client: ReinfolibClient | None = None,
                 output_dir: Path = WEB_DATA_DIR / "hazard") -> dict[str, int]:
    client = client or ReinfolibClient()
    counts: dict[str, int] = {}
    for layer in layers:
        api_id, value_of, combine, label_field = LAYERS[layer]
        layer_dir = output_dir / layer
        index_path = layer_dir / "index.json"
        index = load_json(index_path) if index_path.exists() else {}
        fetched = set(index.get("tiles", []))
        with_features = set(index.get("withFeatures", []))
        labels: dict[str, str] = dict(index.get("labels", {}))
        for x, y in tiles:
            data = client.get(api_id, {"response_format": "geojson", "z": ZOOM, "x": x, "y": y},
                              RAW_DIR / api_id.lower() / f"{ZOOM}_{x}_{y}.json")
            if not isinstance(data, dict) or not isinstance(data.get("features"), list):
                raise RuntimeError(f"{api_id} の応答が GeoJSON FeatureCollection ではありません（{x},{y}）")
            if label_field:
                for feature in data["features"]:
                    text = str((feature.get("properties") or {}).get(label_field))
                    labels[str(value_of(feature["properties"]))] = text
            grid = rasterize(data["features"], value_of, combine, x, y, ZOOM)
            key = f"{ZOOM}/{x}/{y}"
            fetched.add(key)
            tile_path = layer_dir / str(ZOOM) / str(x) / f"{y}.json"
            if grid.any():
                tile_path.parent.mkdir(parents=True, exist_ok=True)
                tile_path.write_text(json.dumps({"size": GRID_SIZE, "rle": encode_rle(grid)}, separators=(",", ":")), encoding="utf-8")
                with_features.add(key)
            else:
                with_features.discard(key)
                tile_path.unlink(missing_ok=True)
        write_json(index_path, {
            "layer": layer, "z": ZOOM, "size": GRID_SIZE, "combine": combine,
            "fetchedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "tiles": sorted(fetched), "withFeatures": sorted(with_features),
            **({"labels": dict(sorted(labels.items(), key=lambda item: int(item[0])))} if label_field else {}),
        })
        counts[layer] = len(with_features)
        LOGGER.info("%s: 取得タイル %d、区域があるタイル %d", layer, len(fetched), len(with_features))
    shutil.copyfile(CONFIG_DIR / "hazard_codes.json", WEB_DATA_DIR / "hazard_codes.json")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="ハザードの区域をタイルごとの格子にして保存します")
    parser.add_argument("--around-local", action="store_true", help="駅の周辺ではなく、手元の掲載物件の周辺だけを取得する")
    parser.add_argument("--layers", default=",".join(LAYERS), help="取得するレイヤー（カンマ区切り）")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    area = load_area()
    if args.around_local:
        tiles = tiles_around(local_listing_points(), LOCAL_BUFFER_KM)
    else:
        tiles = tiles_around(target_station_points(), float(area["hazard"]["buffer_km"]))
    layers = [layer.strip() for layer in args.layers.split(",") if layer.strip()]
    LOGGER.info("タイル %d × レイヤー %d を取得します", len(tiles), len(layers))
    fetch_hazard(tiles, layers)


if __name__ == "__main__":
    main()
