from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from pipeline.fetch_transactions import convert_rows, is_recent, names_match, quarters_to_fetch
from pipeline.reinfolib.client import ApiKeyRejectedError, ApiRequestError, ReinfolibClient

SECRET = "test-secret-key-0000"


class FakeResponse:
    def __init__(self, status: int, body: Any = None) -> None:
        self.status_code = status
        self.ok = 200 <= status < 300
        self._body = body

    def json(self) -> Any:
        return self._body


class FakeSession:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.calls: list[dict[str, Any]] = []

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        return self.responses.pop(0)


def make_client(responses: list[FakeResponse]) -> tuple[ReinfolibClient, FakeSession, list[float]]:
    session = FakeSession(responses)
    slept: list[float] = []
    client = ReinfolibClient(api_key=SECRET, session=session, sleep=slept.append)  # type: ignore[arg-type]
    return client, session, slept


def test_retries_after_server_error(tmp_path: Path) -> None:
    client, session, slept = make_client([FakeResponse(500), FakeResponse(200, {"status": "OK", "data": []})])
    assert client.get("XIT001", {"year": 2025}, tmp_path / "a.json") == {"status": "OK", "data": []}
    assert len(session.calls) == 2
    assert 5 in slept
    assert session.calls[0]["headers"] == {"Ocp-Apim-Subscription-Key": SECRET}


def test_rejected_key_stops_immediately(tmp_path: Path) -> None:
    client, session, _ = make_client([FakeResponse(401), FakeResponse(200, {})])
    with pytest.raises(ApiKeyRejectedError):
        client.get("XIT001", {}, tmp_path / "a.json")
    assert len(session.calls) == 1


def test_gives_up_after_retries(tmp_path: Path) -> None:
    client, session, _ = make_client([FakeResponse(503) for _ in range(4)])
    with pytest.raises(ApiRequestError):
        client.get("XIT001", {}, tmp_path / "a.json")
    assert len(session.calls) == 4


def test_cache_hit_does_not_call_api(tmp_path: Path) -> None:
    cache = tmp_path / "cached.json"
    cache.write_text(json.dumps({"status": "OK", "data": [1]}), encoding="utf-8")
    client, session, _ = make_client([])
    assert client.get("XIT001", {}, cache) == {"status": "OK", "data": [1]}
    assert session.calls == []


def test_key_is_not_logged(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    client, _, _ = make_client([FakeResponse(500), FakeResponse(200, {"data": []})])
    with caplog.at_level(logging.DEBUG):
        client.get("XIT001", {"area": "28"}, tmp_path / "a.json")
    assert SECRET not in caplog.text


def test_names_match_allows_missing_city_prefix() -> None:
    assert names_match("大阪市都島区", "都島区")
    assert names_match("京都市中京区", "中京区")
    assert names_match("尼崎市", "尼崎市")
    assert not names_match("大阪市北区", "堺市北区")


def test_quarters_and_recent_rules() -> None:
    quarters = quarters_to_fetch(date(2026, 9, 27))
    assert quarters[0] == (2021, 1) and quarters[-1] == (2026, 3)
    assert is_recent(2025, 4, date(2026, 9, 27))
    assert not is_recent(2024, 1, date(2026, 9, 27))


def test_convert_rows_filters_and_maps_fields() -> None:
    rows = [
        {"PriceCategory": "成約価格情報", "Type": "中古マンション等", "MunicipalityCode": "28202", "Municipality": "尼崎市",
         "DistrictName": "東難波町", "TradePrice": "25000000", "Area": "70", "FloorPlan": "３ＬＤＫ", "BuildingYear": "2005年",
         "Structure": "ＲＣ", "Period": "2025年第4四半期", "Renovation": "改装済み", "Remarks": "調停・競売等"},
        {"PriceCategory": "成約価格情報", "Type": "宅地(土地)", "MunicipalityCode": "28202", "TradePrice": "1"},
        {"PriceCategory": "成約価格情報", "Type": "中古マンション等", "MunicipalityCode": "28204", "TradePrice": "1"},
    ]
    converted = convert_rows(rows, "02", "28_2025Q4_02", {"28202": "尼崎市"})
    assert len(converted) == 1
    row = converted[0]
    assert row["price_category"] == "contract" and row["period"] == "2025Q4"
    assert row["price_per_sqm"] == pytest.approx(25_000_000 / 70)
    assert row["age_at_trade"] == 20 and row["seismic"] == "new"
    assert row["renovation"] == "renovated" and row["remarks"] == "調停・競売等"
    assert row["floor_plan"] == "3LDK" and row["source"] == "api" and row["nearest_station"] == ""


def test_not_found_is_distinguished(tmp_path: Path) -> None:
    from pipeline.reinfolib.client import ApiNotFoundError
    client, session, _ = make_client([FakeResponse(404)])
    with pytest.raises(ApiNotFoundError):
        client.get("XIT001", {"year": 2026, "quarter": 2}, tmp_path / "a.json")
    assert len(session.calls) == 1
    assert not (tmp_path / "a.json").exists()
