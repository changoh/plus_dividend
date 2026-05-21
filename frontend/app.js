'use strict';

const el = id => document.getElementById(id);

let chart, candleSeries, volumeSeries;
let currentDividends = [];
let isLoading = false;
let visibleStart = null;

const MIN_DATE = '2013-01-01';

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
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
      timeVisible: true,
      fixLeftEdge: true,
      fixRightEdge: true,
    },
    crosshair: {
      vertLine: { color: '#4a4f5e', labelBackgroundColor: '#1c2230' },
      horzLine: { color: '#4a4f5e', labelBackgroundColor: '#1c2230' },
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

  new ResizeObserver(() => {
    chart.applyOptions({ width: el('chart').clientWidth });
  }).observe(el('chart'));
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
    renderMarkers(data.dividends);
    renderHeader(data);
    renderTable(data.dividends, data.last_close);
    currentDividends = data.dividends;
    buildDivMap(data.dividends);

    // 초기 표시: 최근 6개월만 보여주고 스크롤로 과거 탐색
    visibleStart = new Date(monthsAgo(6));
    chart.timeScale().setVisibleRange({
      from: monthsAgo(6),
      to: today(),
    });

    updateScrollHint();
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

const MARKER_COLORS = ['#22c55e', '#f59e0b'];

function renderMarkers(dividends) {
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

function renderTable(dividends, lastClose) {
  const tbody = el('div-tbody');
  if (!dividends.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">분배금 데이터 없음</td></tr>';
    return;
  }
  tbody.innerHTML = [...dividends].reverse().map(d => {
    const annualYield = lastClose > 0
      ? ((d.amount * 12) / lastClose * 100).toFixed(2) + '%'
      : '—';
    return `<tr>
      <td>${d.date}</td>
      <td>${d.amount.toLocaleString()}</td>
      <td class="yield-cell">${annualYield}</td>
    </tr>`;
  }).join('');
}

// ── Scroll hint ───────────────────────────────────────────────────────────────
function updateScrollHint() {
  const hint = el('scroll-hint');
  if (!hint) return;

  if (visibleStart <= new Date(MIN_DATE)) {
    hint.textContent = '✓ 최초 데이터 (2013년)까지 모두 불러왔습니다';
    hint.style.color = '#787b86';
    return;
  }

  const loaded = Math.round((new Date() - visibleStart) / (1000 * 60 * 60 * 24 * 30));
  hint.textContent = `↓ 스크롤하면 1개월씩 이전 데이터 보기 (현재 ${loaded}개월)`;
  hint.style.color = '';
}

// ── 스크롤로 표시 범위 확장 ────────────────────────────────────────────────
let scrollDebounceTimer = null;

window.addEventListener('wheel', (e) => {
  if (e.deltaY <= 0 || isLoading || !visibleStart) return;

  const chartRect = el('chart').getBoundingClientRect();
  if (chartRect.bottom < 0 || chartRect.top > window.innerHeight) return;

  clearTimeout(scrollDebounceTimer);
  scrollDebounceTimer = setTimeout(() => {
    if (visibleStart <= new Date(MIN_DATE)) return;
    visibleStart.setMonth(visibleStart.getMonth() - 1);
    if (visibleStart < new Date(MIN_DATE)) visibleStart = new Date(MIN_DATE);

    chart.timeScale().setVisibleRange({
      from: visibleStart.toISOString().slice(0, 10),
      to: today(),
    });
    updateScrollHint();
  }, 150);
}, { passive: true });

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
loadChart();
