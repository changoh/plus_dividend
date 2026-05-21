#!/usr/bin/env python
"""
로컬에서 실행: python scripts/generate_data.py

- 최초 실행: 2013년부터 전체 OHLCV + 분배금 로드
- 이후 실행: 마지막 캔들 다음 날부터 오늘까지 신규 캔들만 추가 (증분)
             분배금은 항상 로컬 CSV/Excel에서 전체 재로드 (빠름)
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from backend.config import DEFAULT_START, NAME, TICKER
from backend.data_service import get_ohlcv
from backend.dividends import get_dividends, get_dividends_for_ttm

DATA_PATH = ROOT / "frontend" / "data" / "chart.json"


def load_existing() -> dict | None:
    if DATA_PATH.exists():
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def main():
    today = str(date.today())
    existing = load_existing()

    if existing and existing.get("candles"):
        last_date = existing["candles"][-1]["time"]
        next_date = str(date.fromisoformat(last_date) + timedelta(days=1))

        if next_date > today:
            print(f"캔들 이미 최신 상태 (마지막: {last_date})")
            candles = existing["candles"]
        else:
            print(f"신규 캔들 조회: {next_date} ~ {today}")
            new_candles = get_ohlcv(next_date, today)
            if new_candles:
                existing_dates = {c["time"] for c in existing["candles"]}
                added = [c for c in new_candles if c["time"] not in existing_dates]
                candles = existing["candles"] + added
                print(f"  캔들 {len(added)}개 추가 → 누적 {len(candles)}개")
            else:
                print("  신규 캔들 없음 (휴장일 또는 미집계)")
                candles = existing["candles"]
    else:
        print(f"전체 초기 로드: {DEFAULT_START} ~ {today}")
        candles = get_ohlcv(DEFAULT_START, today)
        print(f"  캔들 {len(candles)}개 로드")

    # 분배금은 로컬 파일 기반이므로 항상 전체 재로드
    trading_dates = {c["time"] for c in candles}
    dividends = get_dividends(DEFAULT_START, today, trading_dates)
    print(f"  분배금 {len(dividends)}개 로드")

    last_close = candles[-1]["close"] if candles else 0
    ttm_sum = get_dividends_for_ttm(12)

    data = {
        "ticker": TICKER,
        "name": NAME,
        "last_close": last_close,
        "ttm_yield": round(ttm_sum / last_close * 100, 2) if last_close else None,
        "candles": candles,
        "dividends": dividends,
    }

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    print(f"\n저장 완료: {DATA_PATH.relative_to(ROOT)}")
    print(f"최종: 캔들 {len(candles)}개 | 분배금 {len(dividends)}개 | 현재가 {last_close:,.0f}원")


if __name__ == "__main__":
    main()
