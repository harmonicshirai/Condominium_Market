import pytest

from pipeline.common.parse import (
    index_to_period,
    normalize_text,
    parse_area,
    parse_building_year,
    parse_period,
    parse_price,
    parse_renovation,
    parse_walk_minutes,
    period_index,
    seismic_class,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("  京都市中京区　", "京都市中京区"),
        ("１２３ ＡＢＣ", "123 ABC"),
        ("", None),
        ("   ", None),
        (None, None),
    ],
)
def test_normalize_text(value: str | None, expected: str | None) -> None:
    assert normalize_text(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2024年第3四半期", "2024Q3"),
        ("2024Q3", "2024Q3"),
        ("２０２４年第３四半期", "2024Q3"),
        ("2024年第5四半期", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_period(value: str | None, expected: str | None) -> None:
    assert parse_period(value) == expected


def test_period_index_round_trip() -> None:
    assert period_index("2024Q3") == 2024 * 4 + 2
    assert index_to_period(period_index("2024Q3")) == "2024Q3"


def test_period_index_rejects_invalid_period() -> None:
    with pytest.raises(ValueError):
        period_index("2024Q5")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("59,800,000", 59_800_000),
        ("５９，８００，０００", 59_800_000),
        ("0", 0),
        ("", None),
        ("不明", None),
        ("59,80", None),
        (None, None),
    ],
)
def test_parse_price(value: str | None, expected: int | None) -> None:
    assert parse_price(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("70", (70.0, False)),
        ("2000㎡以上", (2000.0, True)),
        ("７０．５㎡", (70.5, False)),
        ("2,000㎡以上", (2000.0, True)),
        ("", (None, False)),
        ("不明", (None, False)),
        (None, (None, False)),
    ],
)
def test_parse_area(value: str | None, expected: tuple[float | None, bool]) -> None:
    assert parse_area(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2005年", (2005, False)),
        ("平成17年", (2005, False)),
        ("平成元年", (1989, False)),
        ("昭和56年", (1981, False)),
        ("令和2年", (2020, False)),
        ("戦前", (None, True)),
        ("", (None, False)),
        ("不明", (None, False)),
        (None, (None, False)),
    ],
)
def test_parse_building_year(
    value: str | None,
    expected: tuple[int | None, bool],
) -> None:
    assert parse_building_year(value) == expected


@pytest.mark.parametrize(
    ("year", "prewar", "expected"),
    [
        (1980, False, "old"),
        (1981, False, "unknown"),
        (1982, False, "unknown"),
        (1983, False, "new"),
        (None, False, "unknown"),
        (None, True, "old"),
    ],
)
def test_seismic_class(year: int | None, prewar: bool, expected: str) -> None:
    assert seismic_class(year, prewar) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("未改装", "not_renovated"),
        ("改装済", "renovated"),
        ("改装済み物件", "renovated"),
        ("", "unknown"),
        ("不明", "unknown"),
        (None, "unknown"),
    ],
)
def test_parse_renovation(value: str | None, expected: str) -> None:
    assert parse_renovation(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("5", (5, False)),
        ("30分〜60分", (45, False)),
        ("30分～60分", (45, False)),
        ("30分~60分", (45, False)),
        ("30分?60分", (45, False)),
        ("1H〜1H30", (75, False)),
        ("1H30〜2H", (105, False)),
        ("2H〜", (120, True)),
        ("", (None, False)),
        ("不明", (None, False)),
        (None, (None, False)),
    ],
)
def test_parse_walk_minutes(value: str | None, expected: tuple[int | None, bool]) -> None:
    assert parse_walk_minutes(value) == expected
