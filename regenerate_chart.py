"""
frontend/data/chart.json 재생성 스크립트.

사용법 (PowerShell):
    .\.venv\Scripts\Activate.ps1
    $env:DIVIDENDS_EXCEL_PATH = "C:\\Users\\eugene\\Downloads\\PLUS 고배당주 분배금 지급현황_.xlsx"
    python regenerate_chart.py

출력:
    - frontend/data/chart.json (캔들 + 분배금)
    - data/dividends_fallback.csv (엑셀 파싱 결과 동기화)
"""
import json
import sys
from datetime import date
from pathlib import Path

from backend.config import DEFAULT_START, DIVIDENDS_CSV, NAME, TICKER
from backend.data_service import get_ohlcv
from backend.dividends import _load_excel, get_dividends, get_dividends_for_ttm

ROOT = Path(__file__).parent
CHART_JSON = ROOT / "frontend" / "data" / "chart.json"


def main() -> int:
    start = DEFAULT_START
    end = str(date.today())
    print(f"기간: {start} ~ {end}")

    print("[1/3] KRX OHLCV 조회 중 (FinanceDataReader)…")
    candles = get_ohlcv(start, end)
    if not candles:
        print("ERROR: 캔들 데이터를 가져올 수 없음", file=sys.stderr)
        return 1
    print(f"      → {len(candles)} candles ({candles[0]['time']} ~ {candles[-1]['time']})")

    print("[2/3] 분배금 엑셀 파싱 + 거래일 snap…")
    trading_dates = {c["time"] for c in candles}
    dividends = get_dividends(start, end, trading_dates)
    print(f"      → {len(dividends)} dividends")

    last_close = candles[-1]["close"]
    ttm_sum = get_dividends_for_ttm(12)
    ttm_yield = round(ttm_sum / last_close * 100, 2) if last_close > 0 else None
    print(f"      → last_close={last_close}, ttm_yield={ttm_yield}%")

    print(f"[3/3] {CHART_JSON.relative_to(ROOT)} 쓰기…")
    payload = {
        "ticker": TICKER,
        "name": NAME,
        "last_close": last_close,
        "ttm_yield": ttm_yield,
        "candles": candles,
        "dividends": dividends,
    }
    CHART_JSON.parent.mkdir(parents=True, exist_ok=True)
    CHART_JSON.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"      → OK ({CHART_JSON.stat().st_size} bytes)")

    # 분배금 CSV도 동기화 (엑셀이 있을 때만)
    try:
        excel_df = _load_excel()
        excel_df.to_csv(DIVIDENDS_CSV, index=False, encoding="utf-8")
        print(f"      → {DIVIDENDS_CSV.relative_to(ROOT)} 동기화 완료 ({len(excel_df)} rows)")
    except Exception as e:
        print(f"      ! CSV 동기화 건너뜀: {e}")

    print("\n[OK] 완료. 다음 단계:")
    print("   git add frontend/data/chart.json data/dividends_fallback.csv backend/config.py")
    print('   git commit -m "데이터 갱신"')
    print("   git push up2 master")
    return 0


if __name__ == "__main__":
    sys.exit(main())
