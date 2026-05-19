from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import DEFAULT_START, NAME, TICKER
from backend.data_service import get_last_close, get_ohlcv, get_trading_dates_set
from backend.dividends import get_dividends, get_dividends_for_ttm
from backend.models import Candle, ChartResponse, Dividend

app = FastAPI(title="PLUS 고배당주 차트")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://*.vercel.app", "http://localhost:8000", "http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@app.get("/api/chart", response_model=ChartResponse)
def chart(
    start: str = DEFAULT_START,
    end: str = str(date.today()),
):
    candle_records = get_ohlcv(start, end)
    if not candle_records:
        raise HTTPException(status_code=404, detail="데이터 없음")

    trading_dates = {r["time"] for r in candle_records}
    div_records = get_dividends(start, end, trading_dates)

    last_close = candle_records[-1]["close"] if candle_records else 0.0

    ttm_sum = get_dividends_for_ttm(12)
    ttm_yield = round(ttm_sum / last_close * 100, 2) if last_close > 0 else None

    return ChartResponse(
        ticker=TICKER,
        name=NAME,
        last_close=last_close,
        ttm_yield=ttm_yield,
        candles=[Candle(**r) for r in candle_records],
        dividends=[Dividend(**d) for d in div_records],
    )


# Static files must be mounted AFTER API routes (local dev only; Vercel serves from outputDirectory)
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
