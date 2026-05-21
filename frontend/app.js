'use strict';

const el = id => document.getElementById(id);

let chart, candleSeries, volumeSeries;
let currentDividends = [];
let currentLastClose = 0;
let isLoading = false;
let tableShownCount = 5;
let markerMode = 'monthly'; // 'monthly' | 'annual'
let markerDebounceTimer = null;

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

// Lightweight Charts가 반환하는 time 값을 YYYY-MM-DD 문자열로 변환
function toDateStr(time) {
  if (typeof time === 'string') return time;
  if (time && typeof time === 'object' && time.year) {
    return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
  }
  return new Date(time * 1000).toISOString().slice(0, 10);
}

function monthsBetween(from, to) {
  const f = new Date(toDateStr(from));
  const t = new Date(toDateStr(to));
  return (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth());
}

// 연도별 분배금 합산. year 필드 포함해서 반환
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
      timeFormatter: (time) => {
        if (typeof time === 'object' && time.year) {
          return `${time.year}/${String(time.month).padStart(2,'0')}/${String(time.day).padStart(2,'0')}`;
        }
        const d = new Date(time * 1000);
        return `${d.getUTCFullYear()}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}`;
      },
    },
    handleScroll: true,
    handleScale: true,
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#ef4444',
    downColor: '#1d4ed8',
    wickUpColor: '#ef4444',
    wickDownColor: '#1d4ed8',
    borderVisible: false,
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

  // 표시 범위 변경 시: 모드 전환 또는 오버레이 갱신
  chart.timeScale().subscribeVisibleTimeRangeChange(range => {
    if (!range || !currentDividends.length) return;
    clearTimeout(markerDebounceTimer);
    markerDebounceTimer = setTimeout(() => {
      const months = monthsBetween(range.from, range.to);
      const newMode = months > 14 ? 'annual' : 'monthly';
      if (newMode !== markerMode) {
        markerMode = newMode;
        renderMarkers(currentDividends);
      } else if (markerMode === 'annual') {
        // 모드 변화 없어도 범위가 바뀌면 오버레이 위치 재계산
        drawAnnualOverlay();
      }
    }, 120);
  });

  new ResizeObserver(() => {
    chart.applyOptions({ width: el('chart').clientWidth });
    drawAnnualOverlay();
  }).observe(el('chart'));
}

// ── 연간 오버레이: 연말 세로선 + 상단 고정 연간 합산 텍스트 ───────────────
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

  // 연말 세로 구분선 (더 밝게)
  for (let year = startYear; year < endYear; year++) {
    const x = chart.timeScale().timeToCoordinate(`${year}-12-31`);
    if (x === null || x < 0 || x > chartWidth) continue;
    const line = document.createElement('div');
    line.className = 'year-line';
    line.style.left = `${Math.round(x)}px`;
    overlay.appendChild(line);
  }

  // 연간 합산 텍스트 — 연도 + 금액 두 줄, 상단 고정
  const annual = aggregateAnnually(currentDividends);
  let colorIdx = 0;
  let prevAmt = null;
  annual.forEach(({ year, amount }) => {
    if (prevAmt !== null && amount !== prevAmt) colorIdx = 1 - colorIdx;
    prevAmt = amount;

    const x = chart.timeScale().timeToCoordinate(`${year}-07-01`);
    if (x === null || x < 0 || x > chartWidth) return;

    const label = document.createElement('div');
    label.className = 'year-label';
    label.style.left = `${Math.round(x)}px`;
    label.innerHTML =
      `<div class="year-label-yr">${year}</div>` +
      `<div style="color:${MARKER_COLORS[colorIdx]}">${amount.toLocaleString()}원</div>`;
    overlay.appendChild(label);
  });
}

// ── 기간 버튼 ─────────────────────────────────────────────────────────────
const PERIODS = {
  '6m':  () => monthsAgo(6),
  '1y':  () => monthsAgo(12),
  '3y':  () => monthsAgo(36),
  '5y':  () => monthsAgo(60),
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

    currentDividends = data.dividends;
    currentLastClose = data.last_close;
    buildDivMap(data.dividends);
    renderMarkers(data.dividends);
    renderTable();

    chart.timeScale().setVisibleRange({ from: monthsAgo(6), to: today() });
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
  let colorIdx = 0;
  let prevAmount = null;

  const markers = dividends.map(d => {
    if (prevAmount !== null && d.amount !== prevAmount) colorIdx = 1 - colorIdx;
    prevAmount = d.amount;

    if (markerMode === 'monthly') {
      // 14개월 이하: arrowUp + 금액 텍스트
      return {
        time: d.date,
        position: 'belowBar',
        color: MARKER_COLORS[colorIdx],
        shape: 'arrowUp',
        text: `${d.amount.toLocaleString()}원`,
      };
    } else {
      // 14개월 초과: 개별 점 마커 (텍스트 없음, 연간 합산은 오버레이로)
      return {
        time: d.date,
        position: 'belowBar',
        color: MARKER_COLORS[colorIdx],
        shape: 'circle',
        size: 0.5,
      };
    }
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

function handleCrosshair(param) {
  const tooltip = el('tooltip');
  if (!param.time || !param.point) {
    tooltip.classList.add('hidden');
    return;
  }

  const dateStr = typeof param.time === 'string'
    ? param.time
    : new Date(param.time * 1000).toISOString().slice(0, 10);

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
