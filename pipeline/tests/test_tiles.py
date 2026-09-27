from pipeline.common.tiles import lonlat_to_tile, tiles_in_bbox


def test_kyoto_station_tile() -> None:
    assert lonlat_to_tile(135.758767, 34.985849, 14) == (14370, 6490)


def test_osaka_station_tile() -> None:
    assert lonlat_to_tile(135.495951, 34.702485, 14) == (14358, 6506)


def test_tiles_in_area_bbox_count() -> None:
    assert len(tiles_in_bbox(135.47, 34.67, 135.80, 35.03, 14)) == 336
