"""ハザードのコード表を公式資料から作る（python -m pipeline.build_hazard_codes）→ config/hazard_codes.json"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any

import pandas as pd
import requests

from pipeline.common.paths import CONFIG_DIR, RAW_DIR, write_json
from pipeline.hazard_depth import parse_depth_range

LOGGER = logging.getLogger(__name__)
WATER_DEPTH_URL = "https://nlftp.mlit.go.jp/ksj/gml/codelist/water_depth_code.xlsx"
PHENOMENON_URL = "https://nlftp.mlit.go.jp/ksj/gml/codelist/CodeOfPhenomenon.html"
ZONE_URL = "https://nlftp.mlit.go.jp/ksj/gml/codelist/CodeOfZone_A33.html"
OUTPUT_PATH = CONFIG_DIR / "hazard_codes.json"


def read_depth_codes(frame: pd.DataFrame) -> dict[str, dict[str, Any]]:
    """コード表の各行から「整数のコード」と「m を含む区分名」の組を拾う。"""
    codes: dict[str, dict[str, Any]] = {}
    for _, row in frame.iterrows():
        values = [str(value).strip() for value in row.tolist() if str(value).strip() not in ("", "nan", "None")]
        code = next((value for value in values if re.fullmatch(r"\d+(?:\.0)?", value)), None)
        label = next((value for value in values if re.search(r"\d\s*m", value) and ("未満" in value or "以上" in value)), None)
        if code is None or label is None:
            continue
        min_m, max_m = parse_depth_range(label)
        # 「内容」列（床下浸水など）があれば区分名に添える
        rest = [value for value in values if value not in (code, label) and not re.fullmatch(r"\d+(?:\.0)?", value)]
        full_label = f"{label}（{rest[0]}）" if rest else label
        codes[str(int(float(code)))] = {"label": full_label, "minM": min_m, "maxM": max_m}
    if not codes:
        raise ValueError("浸水深ランクのコード表を読み取れませんでした。ファイルの形を確認してください")
    return codes


def fetch_depth_codes() -> dict[str, dict[str, Any]]:
    path = RAW_DIR / "codelist" / "water_depth_code.xlsx"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        response = requests.get(WATER_DEPTH_URL, timeout=60)
        response.raise_for_status()
        path.write_bytes(response.content)
    sheets = pd.read_excel(path, sheet_name=None, header=None)
    return read_depth_codes(pd.concat(sheets.values(), ignore_index=True))


def build_hazard_codes() -> dict[str, Any]:
    codes = {
        "confirmedAt": date.today().isoformat(),
        "floodDepthRank": {"source": WATER_DEPTH_URL, "codes": fetch_depth_codes()},
        # 2026-09-27 に公式のコード表ページで確認した値
        "landslideType": {"source": PHENOMENON_URL, "codes": {"1": "急傾斜地の崩壊", "2": "土石流", "3": "地滑り"}},
        "landslideZone": {
            "source": ZONE_URL,
            "codes": {
                "1": {"label": "土砂災害警戒区域（指定済）", "special": False},
                "2": {"label": "土砂災害特別警戒区域（指定済）", "special": True},
                "3": {"label": "土砂災害警戒区域（指定前）", "special": False},
                "4": {"label": "土砂災害特別警戒区域（指定前）", "special": True},
            },
        },
        "note": "高潮（A49_003）と津波（A40_003）は浸水深の区分が文字列で返るため、コード表ではなく文字列から範囲を求める",
    }
    write_json(OUTPUT_PATH, codes)
    for code, item in codes["floodDepthRank"]["codes"].items():
        LOGGER.info("浸水深ランク %s: %s (%s〜%s m)", code, item["label"], item["minM"], item["maxM"])
    return codes


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    build_hazard_codes()


if __name__ == "__main__":
    main()
