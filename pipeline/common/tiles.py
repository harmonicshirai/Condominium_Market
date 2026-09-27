from __future__ import annotations

import math


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def tiles_in_bbox(
    west: float,
    south: float,
    east: float,
    north: float,
    z: int,
) -> list[tuple[int, int]]:
    x_min, y_max = lonlat_to_tile(west, south, z)
    x_max, y_min = lonlat_to_tile(east, north, z)
    return [(x, y) for x in range(x_min, x_max + 1) for y in range(y_min, y_max + 1)]
