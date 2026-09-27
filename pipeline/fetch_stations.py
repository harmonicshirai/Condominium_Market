"""駅データ（XKT015 駅別乗降客数）と駅別の成約相場（python -m pipeline.fetch_stations）。"""
from __future__ import annotations

import argparse
import logging
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.common.config import load_area
from pipeline.common.parse import period_index
from pipeline.common.paths import INTERIM_DIR, RAW_DIR, REPORTS_DIR, WEB_DATA_DIR, write_json
from pipeline.common.tiles import tiles_in_bbox
from pipeline.reinfolib.client import ReinfolibClient

LOGGER = logging.getLogger(__name__)
ZOOM = 13
PASSENGERS_FIELD = "S12_057"  # 乗降客数（2023年）。API 説明ページで確認済み
MARKET_QUARTERS = 8
MARKET_MIN_COUNT = 5


def normalize_station_name(name: str) -> str:
    """NFKC、末尾の「駅」を除く、「ヶ」を「ケ」にそろえる。"""
    normalized = unicodedata.normalize("NFKC", name).strip()
    normalized = re.sub(r"駅$", "", normalized)
    return normalized.replace("ヶ", "ケ").replace("ヵ", "カ")


# 国交省の駅名の括弧（「尼崎(JR)」「塚口(阪急)」）と、駅データの事業者名の対応
OPERATOR_TAGS = {
    "西日本旅客鉄道": {"JR"}, "東海旅客鉄道": {"JR"}, "阪神電気鉄道": {"阪神"}, "阪急電鉄": {"阪急"},
    "京阪電気鉄道": {"京阪"}, "近畿日本鉄道": {"近鉄"}, "京都市": {"京都市営"}, "大阪市高速電気軌道": {"大阪メトロ"},
    "南海電気鉄道": {"南海"}, "京福電気鉄道": {"嵐電", "京福"}, "叡山電鉄": {"叡電"}, "北大阪急行電鉄": {"北大阪急行"},
    "大阪モノレール": {"大阪モノレール"}, "能勢電鉄": {"能勢電鉄"},
}
# 地域名の括弧（「大宮(京都)」）はどの事業者にも当てはめる
REGION_TAGS = {"京都", "大阪", "兵庫"}


def split_station_name(name: str) -> tuple[str, str | None]:
    """「尼崎(JR)」→（「尼崎」, 「JR」）。括弧がなければ（名前, None）。"""
    normalized = normalize_station_name(name)
    match = re.fullmatch(r"(.+?)\((.+)\)", normalized)
    return (match.group(1), match.group(2)) if match else (normalized, None)


def match_market(station: dict[str, Any], market: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """駅に対応する駅別相場。事業者の括弧が合うものを優先し、なければ地域名の括弧か括弧なしのもの。"""
    base = normalize_station_name(station["name"])
    tags = OPERATOR_TAGS.get(station["operator"], set())
    operator_match = region_match = None
    for key, stats in market.items():
        name, qualifier = split_station_name(key)
        if name != base:
            continue
        if qualifier in tags:
            operator_match = stats
        elif qualifier is None or qualifier in REGION_TAGS:
            region_match = stats
    return operator_match or region_match


def feature_point(geometry: dict[str, Any]) -> tuple[float, float] | None:
    """Point はその点、LineString / MultiLineString は全頂点の平均（経度, 緯度）。"""
    kind = geometry.get("type")
    coords = geometry.get("coordinates")
    if kind == "Point":
        return float(coords[0]), float(coords[1])
    if kind == "LineString":
        points = coords
    elif kind == "MultiLineString":
        points = [point for line in coords for point in line]
    else:
        return None
    if not points:
        return None
    return float(np.mean([p[0] for p in points])), float(np.mean([p[1] for p in points]))


def merge_stations(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """タイルをまたいで重複する（駅名, 事業者, 路線）を1件にまとめる（座標は平均）。"""
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    points: dict[tuple[str, str, str], list[tuple[float, float]]] = defaultdict(list)
    for feature in features:
        props = feature.get("properties") or {}
        point = feature_point(feature.get("geometry") or {})
        name = props.get("S12_001_ja")
        if point is None or not name:
            continue
        key = (str(name), str(props.get("S12_002_ja") or ""), str(props.get("S12_003_ja") or ""))
        points[key].append(point)
        passengers = props.get(PASSENGERS_FIELD)
        entry = grouped.setdefault(key, {
            "code": str(props.get("S12_001c")) if props.get("S12_001c") is not None else None,
            "name": key[0], "operator": key[1], "line": key[2],
            "passengers": None,
        })
        if isinstance(passengers, (int, float)) and passengers > 0:
            entry["passengers"] = int(passengers)
    stations = []
    for key, entry in grouped.items():
        lon = float(np.mean([p[0] for p in points[key]]))
        lat = float(np.mean([p[1] for p in points[key]]))
        stations.append({**entry, "lat": round(lat, 6), "lon": round(lon, 6)})
    return sorted(stations, key=lambda item: (item["operator"], item["line"], item["name"]))


def station_market(transactions: pd.DataFrame) -> dict[str, dict[str, Any]]:
    """CSV 由来の成約事例（採用分）を、直近8四半期・駅名ごとに集計する（5件以上の駅だけ）。"""
    data = transactions.loc[
        transactions["excluded_reason"].astype(str).eq("")
        & transactions["price_category"].astype(str).eq("contract")
        & transactions["nearest_station"].astype(str).str.strip().ne("")
    ].copy()
    if data.empty:
        return {}
    data["pidx"] = data["period"].astype(str).map(period_index)
    latest = int(data["pidx"].max())
    data = data.loc[latest - data["pidx"] < MARKET_QUARTERS]
    data["station_key"] = data["nearest_station"].astype(str).map(lambda value: unicodedata.normalize("NFKC", value).strip())
    data["price_per_sqm"] = pd.to_numeric(data["price_per_sqm"], errors="coerce")
    result: dict[str, dict[str, Any]] = {}
    for key, group in data.groupby("station_key"):
        if len(group) < MARKET_MIN_COUNT:
            continue
        periods = sorted(group["period"].astype(str), key=period_index)
        result[str(key)] = {
            "medianPricePerSqm": int(round(float(np.median(group["price_per_sqm"])))),
            "n": int(len(group)),
            "periodFrom": periods[0],
            "periodTo": periods[-1],
        }
    return result


def fetch_stations(client: ReinfolibClient | None = None, output_dir: Path = WEB_DATA_DIR) -> list[dict[str, Any]]:
    client = client or ReinfolibClient()
    area = load_area()
    bbox = area["bbox"]
    features: list[dict[str, Any]] = []
    tiles = tiles_in_bbox(bbox["west"], bbox["south"], bbox["east"], bbox["north"], ZOOM)
    LOGGER.info("XKT015 を %d タイル取得します", len(tiles))
    for x, y in tiles:
        data = client.get("XKT015", {"response_format": "geojson", "z": ZOOM, "x": x, "y": y},
                          RAW_DIR / "xkt015" / f"{ZOOM}_{x}_{y}.json")
        if not isinstance(data, dict) or not isinstance(data.get("features"), list):
            raise RuntimeError(f"XKT015 の応答が GeoJSON FeatureCollection ではありません（{x},{y}）")
        features.extend(data["features"])
    stations = merge_stations(features)

    pairs = sorted({(item["operator"], item["line"]) for item in stations})
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "station_lines.md").write_text(
        "# 範囲内の（事業者, 路線）\n\n" + "\n".join(f"- {op} / {line}" for op, line in pairs) + "\n",
        encoding="utf-8", newline="\n",
    )
    targets = {(item["operator"], item["line"]) for item in area.get("target_lines", [])}
    if not targets:
        LOGGER.warning("area.json の target_lines が空です。reports/station_lines.md を見て設定してください")

    transactions_path = INTERIM_DIR / "transactions.csv"
    market = {}
    if transactions_path.exists():
        market = station_market(pd.read_csv(transactions_path, dtype={"municipality_code": "string"}, keep_default_na=False))
    for item in stations:
        item["isTargetLine"] = (item["operator"], item["line"]) in targets
        item["market"] = match_market(item, market)
    write_json(output_dir / "stations.json", stations)
    LOGGER.info("駅 %d件（対象路線 %d件、相場あり %d件）を書き出しました",
                len(stations), sum(item["isTargetLine"] for item in stations), sum(item["market"] is not None for item in stations))
    return stations


def main() -> None:
    argparse.ArgumentParser(description="駅データと駅別の成約相場を作成します").parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    fetch_stations()


if __name__ == "__main__":
    main()
