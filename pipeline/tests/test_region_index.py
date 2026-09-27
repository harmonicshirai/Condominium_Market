from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline.build_region_index import fit_period_effects, prepare, smooth

TRUE_EFFECTS = [0.0, 0.05, 0.10, 0.08]


def synthetic(n: int = 800, seed: int = 0, municipalities: tuple[str, ...] = ("28202", "27207")) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        q = int(rng.integers(0, 4))
        code = str(rng.choice(municipalities))
        age = float(rng.uniform(0, 40))
        area = float(rng.uniform(40, 100))
        trade = bool(rng.random() < 0.4)
        log_ppsqm = 13.0 + TRUE_EFFECTS[q] + (0.3 if code == "27207" else 0.0) - 0.015 * age + 0.1 * np.log(area) - 0.05 * trade + rng.normal(0, 0.05)
        rows.append({"period": f"2024Q{q + 1}", "municipality_code": code, "age_at_trade": age, "area_sqm": area,
                     "price_per_sqm": float(np.exp(log_ppsqm)), "price_category": "trade" if trade else "contract"})
    return prepare(pd.DataFrame(rows))


def test_period_effects_are_recovered() -> None:
    effects = fit_period_effects(synthetic(municipalities=("28202",)))
    assert [effects[k] for k in sorted(effects)] == pytest.approx(TRUE_EFFECTS, abs=0.02)


def test_fixed_effects_remove_municipality_mix() -> None:
    # 高い市区町村の事例が後の四半期に偏っても、固定効果があれば四半期の効果は変わらない
    data = synthetic(n=1200)
    late_expensive = data.loc[~((data["municipality_code"] == "27207") & (data["pidx"] < data["pidx"].max()) & (np.arange(len(data)) % 3 != 0))]
    with_fe = fit_period_effects(late_expensive, fixed_effect="municipality_code")
    assert [with_fe[k] for k in sorted(with_fe)] == pytest.approx(TRUE_EFFECTS, abs=0.02)


def test_smooth_is_count_weighted_trailing_mean() -> None:
    values, totals = smooth([0.0, 0.1, None, 0.3], [10, 30, 0, 20], window=2)
    assert values == [0.0, pytest.approx(0.075), pytest.approx(0.1), pytest.approx(0.3)]
    assert totals == [10, 40, 30, 20]
