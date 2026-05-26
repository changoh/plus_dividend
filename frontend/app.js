'use strict';

const el = id => document.getElementById(id);

let chart, candleSeries, volumeSeries;
let currentDividends = [];
let currentLastClose = 0;
let isLoading = false;
let tableShownCount = 5;
let markerMode = 'monthly'; // 'monthly' | 'annual'
let markerDebounceTimer = null;
let tradingDates = []; // 실거래일 목록 — timeToCoordinate에 항상 유효한 날짜 전달용

const MIN_DATE = '2013-01-01';
const MARKER_COLORS = ['#22c55e', '#f59e0b'];

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Lightweight Charts가 반환하는 time 값(object | string | number)을 YYYY-MM-DD로 변환
function toDateStr(time) {
  if (typeof time === 'object' && time !== null && 'year' in time) {
    return `${time.year}-${String(time.month).padStart(2,'0')}-${String(time.day).padStart(2,'0')}`;
  }
  if (typeof time === 'string') return time;
  return new Date(Number(time) * 1000).toISOString().slice(0, 10);
}

function monthsBetween(from, to) {
  const f = new Date(toDateStr(from));
  const t = new Date(toDateStr(to));
  return (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth());
}

// 현재 줌 레벨에서 캔들 폭(barSpacing) 계산 — 원 직경에 직접 사용
function currentBarSpacing() {
  const logicalRange = chart.timeScale().getVisibleLogicalRange();
  if (!logicalRange) return 8;
  const visibleBars = Math.max(1, logicalRange.to - logicalRange.from);
  const dataWidth   = Math.max(1, el('chart').clientWidth - 65);
  return dataWidth / visibleBars;
}

// targetDate 이후 첫 번째 실거래일 반환 (비거래일에 timeToCoordinate가 null 반환하는 문제 방지)
function nearestTradingDay(targetDate) {
  let lo = 0, hi = tradingDates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tradingDates[mid] < targetDate) lo = mid + 1;
    else hi = mid;
  }
  return tradingDates[lo] || null;
}

// 연도별 분배금 합산
function aggregateAnnually(dividends) {
  const byYear = {};
  dividends.forEach(d => {
    const year = d.date.slice(0, 4);
    if (!byYear[year]) byYear[year] = { total: 0 };
    byYear[year].total += d.amount;
  });
  return Object.entries(byYear)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, { total }]) => ({ year, amount: total }));
}

// ── Init chart ──────────────────────────────────────────────────────────────
function initChart() {
  chart = LightweightCharts.createChart(el('chart'), {
    layout: {
      background: { color: '#161b22' },
      textColor: '#d1d4dc',
      fontFamily: "'Pretendard', -apple-system, sans-serif",
    },
    grid: {
      vertLines: { color: '#1e2330' },
      horzLines: { color: '#1e2330' },
    },
    rightPriceScale: { borderColor: '#2a2e39' },
    timeScale: {
      borderColor: '#2a2e39',
      timeVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
    },
    crosshair: {
      vertLine: { color: '#4a4f5e', labelBackgroundColor: '#1c2230' },
      horzLine: { color: '#4a4f5e', labelBackgroundColor: '#1c2230' },
    },
    localization: {
      // time은 object({year,month,day}) | string('YYYY-MM-DD') | number(Unix) 중 하나
      timeFormatter: (time) => {
        let y, m, d;
        if (typeof time === 'object' && time !== null && 'year' in time) {
          y = time.year; m = time.month; d = time.day;
        } else if (typeof time === 'string') {
          [y, m, d] = time.split('-');
        } else {
          const dt = new Date(Number(time) * 1000);
          y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
        }
        return `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
      },
    },
    handleScroll: true,
    handleScale: {
      mouseWheel: false,        // 휠 줌 비활성 — 아래에서 1캔들씩 패닝으로 처리
      pinch: true,
      axisPressedMouseMove: true,
      axisDoubleClickReset: true,
    },
  });

  // 마우스 휠 = 우측 끝(to) 고정, 좌측(from)을 이동시켜 캔들 수만 증감
  //   휠 아래(deltaY>0) → from 좌측으로 → 캔들 수 증가
  //   휠 위(deltaY<0)   → from 우측으로 → 캔들 수 감소
  el('chart').addEventListener('wheel', (e) => {
    e.preventDefault();
    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const step = e.deltaY > 0 ? -10 : 10;
    const newFrom = range.from + step;
    if (range.to - newFrom < 5) return; // 최소 5개 캔들 유지
    chart.timeScale().setVisibleLogicalRange({
      from: newFrom,
      to:   range.to,
    });
  }, { passive: false });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#ef4444',
    downColor: '#1d4ed8',
    wickUpColor: '#ef4444',
    wickDownColor: '#1d4ed8',
    borderVisible: false,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  volumeSeries = chart.addHistogramSeries({
    color: '#334155',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
  });
  volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
  });

  chart.subscribeCrosshairMove(handleCrosshair);

  // 모드 감지 전용 (monthly ↔ annual 전환 시 마커 재렌더) — debounce 유지
  chart.timeScale().subscribeVisibleTimeRangeChange(range => {
    if (!range || !currentDividends.length) return;
    clearTimeout(markerDebounceTimer);
    markerDebounceTimer = setTimeout(() => {
      const months = monthsBetween(range.from, range.to);
      const newMode = months > 36 ? 'annual' : 'monthly';
      if (newMode !== markerMode) {
        markerMode = newMode;
        renderMarkers(currentDividends);
      }
    }, 120);
  });

  // circle 위치/크기 업데이트 — RAF로 캔들과 같은 frame에 동기 그리기 (lag 제거)
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    if (markerMode !== 'annual' || !currentDividends.length) return;
    scheduleOverlayFrame();
  });

  new ResizeObserver(() => {
    chart.applyOptions({ width: el('chart').clientWidth });
    if (markerMode === 'annual') scheduleOverlayFrame();
    else drawAnnualOverlay();
  }).observe(el('chart'));
}

// 다음 repaint 직전에 overlay 다시 그림. 한 frame에 여러 이벤트가 와도 1회만 실행.
let overlayRafId = null;
function scheduleOverlayFrame() {
  if (overlayRafId !== null) return;
  overlayRafId = requestAnimationFrame(() => {
    overlayRafId = null;
    drawAnnualOverlay();
  });
}

// ── 연간 오버레이: 연말 빨간 세로선 + 상단 고정 연간 합산 텍스트 ────────────
function drawAnnualOverlay() {
  const overlay = el('chart-overlay');
  overlay.innerHTML = '';
  if (markerMode !== 'annual' || !currentDividends.length) return;

  const visibleRange = chart.timeScale().getVisibleRange();
  if (!visibleRange) return;

  const fromStr = toDateStr(visibleRange.from);
  const toStr   = toDateStr(visibleRange.to);
  const startYear = new Date(fromStr).getFullYear();
  const endYear   = new Date(toStr).getFullYear();
  const chartWidth = el('chart').clientWidth;

  // 연말 빨간 세로 구분선
  for (let year = startYear; year < endYear; year++) {
    // 12-31이 비거래일일 수 있으므로 해당 연도 마지막 거래일 사용
    const yearEndDate = nearestTradingDay(`${year}-12-28`) || `${year}-12-31`;
    const x = chart.timeScale().timeToCoordinate(yearEndDate);
    if (x === null || x < 0 || x > chartWidth) continue;
    const line = document.createElement('div');
    line.className = 'year-line';
    line.style.left = `${Math.round(x)}px`;
    overlay.appendChild(line);
  }

  // 연간 합산 텍스트 — 7월 1일 이후 첫 거래일 기준으로 상단 고정
  const annual = aggregateAnnually(currentDividends);
  let colorIdx = 0;
  let prevAmt = null;
  annual.forEach(({ year, amount }) => {
    if (prevAmt !== null && amount !== prevAmt) colorIdx = 1 - colorIdx;
    prevAmt = amount;

    // 비거래일 문제 방지: 7월 1일 이후 첫 실거래일 사용
    const labelDate = nearestTradingDay(`${year}-07-01`);
    if (!labelDate) return;

    const x = chart.timeScale().timeToCoordinate(labelDate);
    if (x === null || x < 0 || x > chartWidth) return;

    const label = document.createElement('div');
    label.className = 'year-label';
    label.style.left = `${Math.round(x)}px`;
    label.innerHTML =
      `<div class="year-label-yr">${year}</div>` +
      `<div style="color:${MARKER_COLORS[colorIdx]}">${amount.toLocaleString()}원</div>`;
    overlay.appendChild(label);
  });

  // 분배금 원 — 캔들 2개 폭에 비례하여 직접 그림 (LWC marker 대체)
  drawDividendCircles(overlay, chartWidth);
}

function drawDividendCircles(overlay, chartWidth) {
  const barSpacing = currentBarSpacing();
  const diameter = Math.max(1, barSpacing * 2); // 캔들 2개 폭

  let colorIdx = 0;
  let prevAmount = null;
  currentDividends.forEach(d => {
    if (prevAmount !== null && d.amount !== prevAmount) colorIdx = 1 - colorIdx;
    prevAmount = d.amount;

    const low = divPriceMap[d.date];
    if (low === undefined) return;
    const x = chart.timeScale().timeToCoordinate(d.date);
    if (x === null || x < -diameter || x > chartWidth + diameter) return;
    const y = candleSeries.priceToCoordinate(low);
    if (y === null) return;

    const circle = document.createElement('div');
    circle.className = 'div-circle';
    circle.style.left = `${x}px`;
    circle.style.top = `${y + 4 + diameter / 2}px`; // 캔들 low 아래 4px + 반지름
    circle.style.width = `${diameter}px`;
    circle.style.height = `${diameter}px`;
    circle.style.backgroundColor = MARKER_COLORS[colorIdx];
    overlay.appendChild(circle);
  });
}

// ── 기간 버튼 ─────────────────────────────────────────────────────────────
const PERIODS = {
  '1y':  () => monthsAgo(12),
  '3y':  () => monthsAgo(36),
  '5y':  () => monthsAgo(60),
  '10y': () => monthsAgo(120),
  'all': () => MIN_DATE,
};

function initPeriodButtons() {
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chart.timeScale().setVisibleRange({
        from: PERIODS[btn.dataset.period](),
        to: today(),
      });
      // debounce 없이 즉시 모드/크기 반영
      setTimeout(() => {
        if (!currentDividends.length) return;
        const range = chart.timeScale().getVisibleRange();
        if (!range) return;
        const months = monthsBetween(range.from, range.to);
        markerMode = months > 36 ? 'annual' : 'monthly';
        renderMarkers(currentDividends);
      }, 50);
    });
  });
}

// ── 데이터 로드 (정적 JSON) ────────────────────────────────────────────────
async function loadChart() {
  if (isLoading) return;
  isLoading = true;
  showLoading(true);

  try {
    const res = await fetch('/data/chart.json');
    if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
    const data = await res.json();

    renderCandles(data.candles);
    renderVolume(data.candles);
    renderHeader(data);

    // 실거래일 목록 저장 (오름차순 정렬 보장)
    tradingDates = data.candles.map(c => c.time).sort();

    currentDividends = data.dividends;
    currentLastClose = data.last_close;
    buildDivMap(data.dividends);
    buildDivPriceMap(data.candles, data.dividends);
    renderMarkers(data.dividends);
    renderTable();

    chart.timeScale().setVisibleRange({ from: monthsAgo(12), to: today() });
  } catch (err) {
    showToast('데이터를 불러올 수 없습니다: ' + err.message);
  } finally {
    showLoading(false);
    isLoading = false;
  }
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderCandles(candles) {
  candleSeries.setData(candles.map(c => ({
    time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
  })));
}

function renderVolume(candles) {
  volumeSeries.setData(candles.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? '#7f1d1d' : '#1e3a5f',
  })));
}

function renderMarkers(dividends) {
  // annual 모드: LWC markers 비움 → drawAnnualOverlay가 직접 원을 그림 (LWC size 제약 우회)
  if (markerMode === 'annual') {
    candleSeries.setMarkers([]);
    drawAnnualOverlay();
    return;
  }

  let colorIdx = 0;
  let prevAmount = null;
  const markers = dividends.map(d => {
    if (prevAmount !== null && d.amount !== prevAmount) colorIdx = 1 - colorIdx;
    prevAmount = d.amount;
    return {
      time: d.date,
      position: 'belowBar',
      color: MARKER_COLORS[colorIdx],
      shape: 'arrowUp',
      text: `${d.amount.toLocaleString()}원`,
    };
  });
  candleSeries.setMarkers(markers);
  drawAnnualOverlay();
}

function renderHeader(data) {
  el('etf-name').textContent = data.name;
  el('ticker').textContent = data.ticker;
  el('last-close').textContent = data.last_close
    ? data.last_close.toLocaleString('ko-KR') + '원'
    : '—';
  el('ttm-yield').textContent = data.ttm_yield != null
    ? data.ttm_yield.toFixed(2) + '%'
    : '—';
}

// ── 분배금 테이블 (5개 기본, 20개씩 펼침 / 접기) ─────────────────────────
function renderTable() {
  const tbody = el('div-tbody');
  const reversed = [...currentDividends].reverse();

  if (!reversed.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">분배금 데이터 없음</td></tr>';
    el('expand-btn').classList.add('hidden');
    el('collapse-btn').classList.add('hidden');
    return;
  }

  tbody.innerHTML = reversed.slice(0, tableShownCount).map(d => {
    const annualYield = currentLastClose > 0
      ? ((d.amount * 12) / currentLastClose * 100).toFixed(2) + '%'
      : '—';
    return `<tr>
      <td>${d.date}</td>
      <td>${d.amount.toLocaleString()}</td>
      <td class="yield-cell">${annualYield}</td>
    </tr>`;
  }).join('');

  const remaining = reversed.length - tableShownCount;
  const expandBtn = el('expand-btn');
  if (remaining > 0) {
    expandBtn.classList.remove('hidden');
    expandBtn.textContent = `▼ 더 보기 (${Math.min(20, remaining)}개)`;
  } else {
    expandBtn.classList.add('hidden');
  }

  el('collapse-btn').classList.toggle('hidden', tableShownCount <= 5);
}

// ── Crosshair tooltip ─────────────────────────────────────────────────────────
const divMap = {};
const divPriceMap = {}; // 분배금 날짜 → 해당 캔들 low (overlay 원 y좌표 계산용)

function buildDivMap(dividends) {
  Object.keys(divMap).forEach(k => delete divMap[k]);
  let colorIdx = 0;
  let prevAmount = null;
  dividends.forEach(d => {
    if (prevAmount !== null && d.amount !== prevAmount) colorIdx = 1 - colorIdx;
    prevAmount = d.amount;
    divMap[d.date] = { amount: d.amount, color: MARKER_COLORS[colorIdx] };
  });
}

function buildDivPriceMap(candles, dividends) {
  Object.keys(divPriceMap).forEach(k => delete divPriceMap[k]);
  const lowByDate = {};
  candles.forEach(c => { lowByDate[c.time] = c.low; });
  dividends.forEach(d => {
    if (lowByDate[d.date] !== undefined) {
      divPriceMap[d.date] = lowByDate[d.date];
    }
  });
}

function handleCrosshair(param) {
  const tooltip = el('tooltip');
  if (!param.time || !param.point) {
    tooltip.classList.add('hidden');
    return;
  }

  const dateStr = toDateStr(param.time);
  const entry = divMap[dateStr];
  if (!entry) {
    tooltip.classList.add('hidden');
    return;
  }

  const { amount, color } = entry;
  const priceData = param.seriesData.get(candleSeries);
  const close = priceData ? priceData.close : null;
  const yieldStr = close ? ((amount * 12) / close * 100).toFixed(2) + '%' : '—';

  tooltip.innerHTML = `
    <div class="tooltip-title" style="color:${color}">분배금 지급일</div>
    <div class="tooltip-row"><span class="tooltip-label">날짜</span><span>${dateStr}</span></div>
    <div class="tooltip-row"><span class="tooltip-label">분배금</span><span>${amount.toLocaleString()}원</span></div>
    <div class="tooltip-row"><span class="tooltip-label">연환산</span><span style="color:${color}">${yieldStr}</span></div>
  `;

  const x = param.point.x + 16;
  const y = param.point.y - 10;
  const tipW = 160;
  const adjustedX = x + tipW > el('chart').clientWidth ? x - tipW - 32 : x;
  tooltip.style.left = adjustedX + 'px';
  tooltip.style.top = y + 'px';
  tooltip.classList.remove('hidden');
}

// ── Toast / Loading ───────────────────────────────────────────────────────────
function showToast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 4000);
}

function showLoading(show) {
  el('loading').classList.toggle('hidden', !show);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
initChart();
initPeriodButtons();

el('expand-btn').addEventListener('click', () => {
  tableShownCount += 20;
  renderTable();
});

el('collapse-btn').addEventListener('click', () => {
  tableShownCount = 5;
  renderTable();
});

loadChart();
