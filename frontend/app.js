'use strict';

const el = id => document.getElementById(id);

let chart, candleSeries, volumeSeries;
let currentDividends = [];
let currentLastClose = 0;
let isLoading = false;
let tableShownCount = 5;

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
    renderMarkers(data.dividends);
    renderHeader(data);

    currentDividends = data.dividends;
    currentLastClose = data.last_close;
    buildDivMap(data.dividends);
    renderTable();

    // 초기 표시: 최근 6개월
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

// ── 분배금 테이블 (5개 기본, 20개씩 펼침) ──────────────────────────────────
function renderTable() {
  const tbody = el('div-tbody');
  const reversed = [...currentDividends].reverse();

  if (!reversed.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">분배금 데이터 없음</td></tr>';
    el('expand-btn').classList.add('hidden');
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
  if (remaining <= 0) {
    expandBtn.classList.add('hidden');
  } else {
    expandBtn.classList.remove('hidden');
    expandBtn.textContent = `▼ 더 보기 (${Math.min(20, remaining)}개)`;
  }
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

loadChart();
