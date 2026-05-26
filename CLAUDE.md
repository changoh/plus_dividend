# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개발 서버 실행

```powershell
# 가상환경 활성화 + 서버 시작 (Windows PowerShell)
.\.venv\Scripts\Activate.ps1
uvicorn backend.app:app --reload --port 8000

# 또는 한 번에
.\run.ps1
```

엑셀 분배금 파일이 있을 경우 환경변수 지정:
```powershell
$env:DIVIDENDS_EXCEL_PATH = "C:\Users\eugene\Downloads\PLUS 고배당주 분배금 지급현황_.xlsx"
uvicorn backend.app:app --reload --port 8000
```

브라우저: `http://localhost:8000/`  
API 문서: `http://localhost:8000/docs`

## 의존성 설치

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 아키텍처

### 전체 데이터 흐름

```
[데이터 갱신 시]
  regenerate_chart.py 또는 scripts/generate_data.py
       ├─ FinanceDataReader → OHLCV
       ├─ dividends.py → 분배금 (엑셀 또는 CSV)
       └─ frontend/data/chart.json 생성 (캔들 + 분배금 + ttm_yield)

[브라우저 렌더링 시]
  fetch('/data/chart.json')       ← 정적 파일 단일 요청 (API 호출 없음)
       └─ TradingView Lightweight Charts 렌더링 (frontend/app.js)
```

로컬 개발 시에는 FastAPI(`/api/chart`)가 live API로 동작하지만, **프론트엔드는 항상 `/data/chart.json` 정적 파일을 사용**한다.

### 백엔드 레이어 (`backend/`)

- **`app.py`**: FastAPI 앱. `GET /api/chart` 엔드포인트 (로컬 개발용). 정적 파일 마운트는 반드시 API 라우트 등록 이후에 위치해야 함 (순서 중요).
- **`data_service.py`**: FinanceDataReader로 OHLCV 조회. `(start, end)` 튜플을 키로 6시간 인메모리 캐시. 서버 재시작 시 캐시 초기화됨.
- **`dividends.py`**: 분배금 로딩 우선순위 — `DIVIDENDS_EXCEL_PATH` 환경변수 경로 엑셀 → `data/dividends_fallback.csv` 순서. 분배금 날짜가 휴일이면 직전 거래일로 snap 처리.
- **`config.py`**: 티커(`161510`), 기본 시작일, 파일 경로 중앙 관리.
- **`models.py`**: Pydantic 스키마 (`Candle`, `Dividend`, `ChartResponse`).

### 프론트엔드 (`frontend/`)

- **`app.js`**: `/data/chart.json` 단일 fetch 후 전체 렌더링. API 호출 없음.
  - `buildDivMap()`: 분배금 날짜 → `{ amount, color }` 매핑. crosshair tooltip에 사용.
  - `buildDivPriceMap()`: 분배금 날짜 → 해당 캔들 low 가격. 오버레이 원 y좌표 계산에 사용.
  - `tradingDates[]`: 비거래일에 `timeToCoordinate()`가 `null`을 반환하는 문제를 방지하기 위해 실거래일 목록을 유지.
- **`index.html`**: CDN으로 TradingView Lightweight Charts v4.1.3, Pretendard 폰트 로드. 빌드 스텝 없음.
- **`style.css`**: CSS 변수 기반 다크 테마. 한국 주식 색상 관례 (빨강=상승, 파랑=하락).

### 분배금 마커 렌더링 (두 가지 모드)

zoom 레벨에 따라 모드가 자동 전환된다 (`monthsBetween > 36` → annual).

- **monthly 모드**: LWC 내장 `setMarkers()` 사용 (`arrowUp` shape).
- **annual 모드**: `setMarkers([])`로 LWC 마커 제거 후, `#chart-overlay` div에 DOM 엘리먼트를 직접 그림. LWC의 marker 최소 크기 제약을 우회하기 위한 설계.
  - `div.year-line`: 연말 빨간 세로선
  - `div.year-label`: 연간 합산 텍스트 (7월 1일 기준 위치)
  - `div.div-circle`: 분배금 원 (캔들 2개 폭에 비례한 직경)

마커 색상: 금액이 변경될 때마다 교대 (`MARKER_COLORS = ['#22c55e', '#f59e0b']`). `renderMarkers()`, `buildDivMap()`, `drawDividendCircles()` 세 곳에서 동일 로직을 독립적으로 수행하므로 **수정 시 세 함수 모두 변경**해야 함.

## 데이터 갱신 스크립트

### `regenerate_chart.py` — 전체 재생성 (엑셀 필요)

```powershell
.\.venv\Scripts\Activate.ps1
$env:DIVIDENDS_EXCEL_PATH = "C:\Users\eugene\Downloads\PLUS 고배당주 분배금 지급현황_.xlsx"
python regenerate_chart.py
```

`frontend/data/chart.json`과 `data/dividends_fallback.csv`를 모두 재생성한다.

### `scripts/generate_data.py` — 증분 갱신 (엑셀 불필요)

```powershell
.\.venv\Scripts\Activate.ps1
python scripts/generate_data.py
```

기존 `chart.json`이 있으면 마지막 캔들 다음 날부터만 신규 OHLCV를 추가한다. 분배금은 항상 로컬 CSV에서 전체 재로드.

## 분배금 데이터 업데이트

실제 데이터 출처: [plusetf.co.kr](https://www.plusetf.co.kr/product/detail?n=006273) → 분배금 지급현황 엑셀 다운로드

엑셀 형식: Row 0 = 제목행, Row 1 = 컬럼명(`지급기준일 / 지급예정일 / 분배금(원) / 누적배당누계액(원)`), Row 2~ = 데이터 (역순).

분배금 이력:
- 2013~2024.04: **연 1회** 지급 (매년 4월 말, 260~750원)
- 2024.05~현재: **월간** 지급 (63~86원/월)

## 배포

- **Vercel** (프론트엔드): `vercel.json`의 `outputDirectory: "frontend"`. `frontend/` 디렉터리 전체를 정적으로 서빙. `/api/*` rewrite 없음 — 프론트엔드가 `chart.json`만 사용하기 때문.
- **Render** (백엔드): `render.yaml` 참조. Start command: `uvicorn backend.app:app --host 0.0.0.0 --port $PORT`. 로컬 개발용으로만 사용. 무료 플랜은 15분 비활동 시 cold start 발생.
- `*.xlsx` 파일은 `.gitignore`에 포함되어 git에 올라가지 않음. 서버에서는 `data/dividends_fallback.csv`가 자동으로 사용됨.
- 데이터 갱신 후 배포: `git add frontend/data/chart.json data/dividends_fallback.csv && git commit && git push`
