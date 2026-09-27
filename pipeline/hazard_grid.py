"""ハザードの区域（ポリゴン）を、z=14 タイルごとの格子（既定 128×128、1マス約16m）に焼き込む。

区域の形をそのまま配ると1タイル1MBを超えるため、マスごとの値だけをランレングス圧縮して配る。
"""
from __future__ import annotations

import math
from collections.abc import Callable, Iterable
from typing import Any

import numpy as np

GRID_SIZE = 128


def lonlat_to_tile_fraction(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2**z
    lat_rad = math.radians(lat)
    return (lon + 180.0) / 360.0 * n, (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n


def _ring_to_cells(ring: list[list[float]], x: int, y: int, z: int, size: int) -> np.ndarray:
    points = [lonlat_to_tile_fraction(lon, lat, z) for lon, lat, *_ in ring]
    return np.array([((fx - x) * size, (fy - y) * size) for fx, fy in points], dtype=float)


def _inside(ring: np.ndarray, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """偶奇規則（レイキャスト）で、点が輪の内側か。"""
    inside = np.zeros(px.shape, dtype=bool)
    x1, y1 = ring[:-1, 0], ring[:-1, 1]
    x2, y2 = ring[1:, 0], ring[1:, 1]
    for ax, ay, bx, by in zip(x1, y1, x2, y2):
        if ay == by:
            continue
        crosses = (ay > py) != (by > py)
        x_at = (bx - ax) * (py - ay) / (by - ay) + ax
        inside ^= crosses & (px < x_at)
    return inside


def polygon_mask(coordinates: list[Any], kind: str, x: int, y: int, z: int, size: int = GRID_SIZE) -> np.ndarray:
    """Polygon / MultiPolygon が覆うマス（マスの中心で判定）。穴は除く。"""
    mask = np.zeros((size, size), dtype=bool)
    polygons = [coordinates] if kind == "Polygon" else coordinates
    for polygon in polygons:
        rings = [_ring_to_cells(ring, x, y, z, size) for ring in polygon if len(ring) >= 4]
        if not rings:
            continue
        outer = rings[0]
        col_lo = max(int(math.floor(outer[:, 0].min() - 0.5)), 0)
        col_hi = min(int(math.ceil(outer[:, 0].max() - 0.5)), size - 1)
        row_lo = max(int(math.floor(outer[:, 1].min() - 0.5)), 0)
        row_hi = min(int(math.ceil(outer[:, 1].max() - 0.5)), size - 1)
        if col_lo > col_hi or row_lo > row_hi:
            continue
        cols, rows = np.meshgrid(np.arange(col_lo, col_hi + 1), np.arange(row_lo, row_hi + 1))
        px, py = cols + 0.5, rows + 0.5
        inside = _inside(outer, px, py)
        for hole in rings[1:]:
            inside &= ~_inside(hole, px, py)
        mask[row_lo:row_hi + 1, col_lo:col_hi + 1] |= inside
    return mask


def rasterize(features: Iterable[dict[str, Any]], value_of: Callable[[dict[str, Any]], int], combine: str,
              x: int, y: int, z: int, size: int = GRID_SIZE) -> np.ndarray:
    """マスごとの値。combine="max" は最大値、"or" はビットの論理和。"""
    grid = np.zeros((size, size), dtype=np.int32)
    for feature in features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        value = value_of(feature.get("properties") or {})
        if value <= 0:
            continue
        mask = polygon_mask(geometry["coordinates"], geometry["type"], x, y, z, size)
        if combine == "max":
            grid[mask] = np.maximum(grid[mask], value)
        else:
            grid[mask] |= value
    return grid


def encode_rle(grid: np.ndarray) -> str:
    """行優先で「値:個数」をカンマでつなぐ。例: "0:120,2:8,0:16256" """
    flat = grid.ravel()
    parts: list[str] = []
    start = 0
    for index in range(1, len(flat) + 1):
        if index == len(flat) or flat[index] != flat[start]:
            parts.append(f"{int(flat[start])}:{index - start}")
            start = index
    return ",".join(parts)


def decode_rle(text: str, size: int = GRID_SIZE) -> np.ndarray:
    values: list[int] = []
    for part in text.split(","):
        value, count = part.split(":")
        values.extend([int(value)] * int(count))
    return np.array(values, dtype=np.int32).reshape(size, size)
