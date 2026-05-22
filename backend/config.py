import os
from pathlib import Path

TICKER = "161510"
NAME = "PLUS 고배당주"
DEFAULT_START = "2013-01-01"
CACHE_TTL_SECONDS = 60 * 60 * 6

BASE_DIR = Path(__file__).parent.parent
DIVIDENDS_CSV = BASE_DIR / "data" / "dividends_fallback.csv"

# 환경변수 DIVIDENDS_EXCEL_PATH가 있으면 엑셀 우선 사용, 없으면 CSV fallback
DIVIDENDS_EXCEL = Path(os.getenv("DIVIDENDS_EXCEL_PATH", ""))
