from __future__ import annotations

import argparse
import logging

from pipeline.build_price_index import main as build_price_index_main
from pipeline.build_site_data import main as build_site_data_main
from pipeline.build_region_index import main as build_region_index_main
from pipeline.fetch_transactions import KANSAI_PATH, fetch_kansai_transactions, fetch_transactions
from pipeline.import_csv import main as import_csv_main
from pipeline.normalize import main as normalize_main
from pipeline.quality_report import main as quality_report_main
from pipeline.quality_report import municipalities_without_data


def main() -> None:
    parser = argparse.ArgumentParser(description="成約事例データを加工してサイト用 JSON を作成します")
    parser.add_argument("--api", action="store_true", help="API（XIT001）からも取得します。CSV がある期間は CSV を優先します")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    steps = [import_csv_main]
    if args.api:
        steps.extend([fetch_transactions, fetch_kansai_transactions])
    for step in (
        *steps,
        normalize_main,
        quality_report_main,
        build_price_index_main,
        build_site_data_main,
    ):
        step()
    if KANSAI_PATH.exists():
        build_region_index_main()
    else:
        print("関西平均の元データがないため、騰落指数は作り直していません（--api を付けると作ります）")
    missing = municipalities_without_data()
    if missing:
        print(
            "\n!!! 次の市区町村はデータがありません。該当府県の CSV を data/manual_csv/ に追加してください: "
            + "、".join(missing) + " !!!\n"
        )


if __name__ == "__main__":
    main()
