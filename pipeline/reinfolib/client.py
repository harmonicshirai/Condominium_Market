"""国土交通省 不動産情報ライブラリ API のクライアント。キーはログやエラーに出さない。"""
from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import requests
from dotenv import dotenv_values

from pipeline.common.paths import ROOT

LOGGER = logging.getLogger(__name__)
BASE_URL = "https://www.reinfolib.mlit.go.jp/ex-api/external/"
RETRY_WAITS = (5, 15, 45)
RETRY_STATUSES = {429, 500, 502, 503, 504}


class MissingApiKeyError(RuntimeError):
    """REINFOLIB_API_KEY が設定されていない。"""


class ApiKeyRejectedError(RuntimeError):
    """401・403（キーが無効など）。再試行しない。"""


class ApiRequestError(RuntimeError):
    """再試行しても取得できなかった。"""


class ApiNotFoundError(ApiRequestError):
    """404。XIT001 では未公開の四半期を指定したときに返る。"""


def load_api_key(env_path: Path = ROOT / ".env") -> str:
    key = (os.environ.get("REINFOLIB_API_KEY") or dotenv_values(env_path).get("REINFOLIB_API_KEY") or "").strip()
    if not key:
        raise MissingApiKeyError(".env に REINFOLIB_API_KEY を設定してください")
    return key


class ReinfolibClient:
    def __init__(
        self,
        api_key: str | None = None,
        sleep_sec: float = 1.5,
        session: requests.Session | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._api_key = api_key if api_key is not None else load_api_key()
        self.sleep_sec = sleep_sec
        self.session = session or requests.Session()
        self.clock = clock
        self.sleep = sleep
        self.last_request_at: float | None = None
        self.requests_made = 0

    def _wait(self) -> None:
        if self.last_request_at is not None:
            remaining = self.sleep_sec - (self.clock() - self.last_request_at)
            if remaining > 0:
                self.sleep(remaining)
        self.last_request_at = self.clock()

    def get(self, api_id: str, params: dict[str, Any], cache_path: Path | None = None, force: bool = False) -> Any:
        if cache_path is not None and cache_path.exists() and not force:
            with cache_path.open(encoding="utf-8") as file:
                return json.load(file)
        url = BASE_URL + api_id
        last_problem = ""
        for attempt in range(len(RETRY_WAITS) + 1):
            self._wait()
            try:
                response = self.session.get(
                    url, params=params, headers={"Ocp-Apim-Subscription-Key": self._api_key}, timeout=60,
                )
            except (requests.Timeout, requests.ConnectionError) as error:
                last_problem = type(error).__name__
            else:
                self.requests_made += 1
                LOGGER.info("%s %s -> %s", api_id, params, response.status_code)
                if response.status_code in (401, 403):
                    raise ApiKeyRejectedError(f"{api_id}: HTTP {response.status_code}。APIキーを確認してください")
                if response.ok:
                    data = response.json()
                    if cache_path is not None:
                        cache_path.parent.mkdir(parents=True, exist_ok=True)
                        with cache_path.open("w", encoding="utf-8") as file:
                            json.dump(data, file, ensure_ascii=False)
                    return data
                if response.status_code == 404:
                    raise ApiNotFoundError(f"{api_id}: HTTP 404 {params}")
                if response.status_code not in RETRY_STATUSES:
                    raise ApiRequestError(f"{api_id}: HTTP {response.status_code}")
                last_problem = f"HTTP {response.status_code}"
            if attempt < len(RETRY_WAITS):
                LOGGER.warning("%s を再試行します（%s、%d秒後）", api_id, last_problem, RETRY_WAITS[attempt])
                self.sleep(RETRY_WAITS[attempt])
        raise ApiRequestError(f"{api_id}: 再試行しても取得できませんでした（{last_problem}）")
