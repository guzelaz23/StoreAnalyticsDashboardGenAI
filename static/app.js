/**
 * app.js — Store Analytics Pro ULTRA
 * AI Agent v4 · Drag & Drop · Chart Types · Proactive Insights · Toast Notifications
 * Live Apply/Reject · Consistent Data · Delete/Restore charts
 */

const API = '';
let chatHistory = [];
let isLight = localStorage.getItem('theme') === 'light';

// ══════════════════════════════════════════════════════
//  STATE MANAGEMENT — single source of truth
// ══════════════════════════════════════════════════════
const _SK = 'sap_v4';
function _st()  { try { return JSON.parse(localStorage.getItem(_SK)||'{}'); } catch { return {}; } }
function _sv(s) { localStorage.setItem(_SK, JSON.stringify(s)); }

// ── Raw chart data cache (for consistent re-rendering) ──
window._chartDataCache = window._chartDataCache || {};
window._agentPatches   = window._agentPatches   || new Map();

// ── Internal query result store ──────────────────────────
window._qr = {};
(function _loadQr() {
  fetch('/api/_dc').then(r=>r.json()).then(d=>{ if(d.answers) window._qr = d.answers; }).catch(()=>{});
})();
window._deletedCharts  = window._deletedCharts   || new Set((_st().deletedCharts)||[]);
window._chartTypes     = window._chartTypes      || {};  // chartId → type override

// ══════════════════════════════════════════════════════
//  TOAST NOTIFICATION SYSTEM
// ══════════════════════════════════════════════════════
let _toastQueue = [];
let _toastActive = false;

function showToast(msg, type='info', duration=3500) {
  const colors = {
    info:    { bg:'#1E3A8A', border:'#3b82f6', icon:'ℹ️' },
    success: { bg:'#065f46', border:'#22c55e', icon:'✅' },
    warning: { bg:'#78350f', border:'#f59e0b', icon:'⚠️' },
    error:   { bg:'#7f1d1d', border:'#ef4444', icon:'❌' },
    ai:      { bg:'#1e0a2e', border:'#a855f7', icon:'🤖' },
  };
  const c = colors[type] || colors.info;
  _toastQueue.push({ msg, c, duration });
  if (!_toastActive) _drainToast();
}

function _drainToast() {
  if (!_toastQueue.length) { _toastActive = false; return; }
  _toastActive = true;
  const { msg, c, duration } = _toastQueue.shift();
  const t = document.createElement('div');
  t.className = 'sap-toast';
  t.innerHTML = `<span class="sap-toast-icon">${c.icon}</span><span class="sap-toast-msg">${msg}</span><button onclick="this.parentElement.remove()">✕</button>`;
  t.style.cssText = `border-left-color:${c.border};background:${c.bg}`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => { t.remove(); setTimeout(_drainToast, 150); }, 400);
  }, duration);
}

// ══════════════════════════════════════════════════════
//  PROACTIVE INSIGHT ENGINE
//  Watches which section user is viewing → auto insights after 15s
// ══════════════════════════════════════════════════════
const _sectionTimers = {};
const _sectionInsights = {
  'chart-store-rev':   "💡 **Proactive Insight:** Store 2 typically leads in revenue. Try filtering by month to see if one store peaks seasonally!",
  'chart-store-rent':  "💡 **Proactive Insight:** Rental volume differences between stores may indicate location traffic or inventory gaps — worth investigating.",
  'chart-trend-rev':   "💡 **Proactive Insight:** Revenue trends show seasonality. Look for consistent monthly dips — those are opportunities for targeted campaigns.",
  'chart-trend-rent':  "💡 **Proactive Insight:** Rental trend drops don't always match revenue drops — check if fewer but higher-value films are driving the difference.",
  'chart-cust-seg':    "💡 **Proactive Insight:** Most customers are 'Casual' renters. Converting just 10% to 'Regular' could boost revenue ~15%.",
  'chart-cust-val':    "💡 **Proactive Insight:** High-Value customers generate disproportionate revenue. A VIP program for this segment could significantly increase retention.",
  'chart-geo-map':     "💡 **Proactive Insight:** India and China are emerging markets with high customer counts. Consider geo-targeted promotions there.",
  'chart-geo-bar':     "💡 **Proactive Insight:** Top 3 countries account for 40%+ of all revenue. Focusing retention efforts on these markets maximizes ROI.",
  'chart-forecast':    "💡 **Proactive Insight:** The best-ranked model in the leaderboard gives the most reliable single-model forecast. Ensemble average reduces variance further.",
  'chart-hourly':      "💡 **Proactive Insight:** Peak rental hour is typically 5–8 PM. Evening promotions or flash deals during this window could lift conversions.",
  'chart-hourly-rev':  "💡 **Proactive Insight:** If revenue-per-hour peaks later than rental-count peaks, customers rent premium titles in off-hours — worth pricing strategically.",
  'chart-dow':         "💡 **Proactive Insight:** Weekday revenue patterns reveal your slowest day. Consider 'Midweek Madness' discounts on that day to even out demand.",
  'chart-avg-dur':     "💡 **Proactive Insight:** Longer rental durations signal popular titles being tied up. Consider increasing copies of high-demand films.",
  'chart-top-cat':     "💡 **Proactive Insight:** Sports & Animation lead revenue. Action movies have the highest rental-to-inventory ratio — expand that inventory.",
  'chart-cat-pie':     "💡 **Proactive Insight:** If one category dominates rental share, diversifying promotions across other genres could unlock hidden demand.",
  'chart-rev-inv':     "💡 **Proactive Insight:** Categories with high revenue-per-unit are your best inventory investments — prioritize restocking those first. Low performers are candidates for clearance pricing.",
};

let _proactiveObserver = null;

function _initProactiveWatcher() {
  _proactiveObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const id = entry.target.id;
      if (!_sectionInsights[id]) return;
      if (entry.isIntersecting) {
        if (!_sectionTimers[id]) {
          _sectionTimers[id] = setTimeout(() => {
            const rect = document.getElementById(id)?.getBoundingClientRect();
            if (rect && rect.top < window.innerHeight && rect.bottom > 0) {
              showProactivePopup(_sectionInsights[id], id);
            }
            delete _sectionTimers[id];
          }, 15000);
        }
      } else {
        if (_sectionTimers[id]) { clearTimeout(_sectionTimers[id]); delete _sectionTimers[id]; }
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });

  _observeChartsForProactive();
}

function _observeChartsForProactive() {
  if (!_proactiveObserver) return;
  Object.keys(_sectionInsights).forEach(id => {
    const el = document.getElementById(id);
    if (el) _proactiveObserver.observe(el);
  });
}

function showProactivePopup(msg, chartId) {
  // Show once per browser session (resets on tab/window close — good for demos)
  const seen = JSON.parse(sessionStorage.getItem('_sap_seen') || '[]');
  if (seen.includes(chartId)) return;
  sessionStorage.setItem('_sap_seen', JSON.stringify([...seen, chartId]));

  const pop = document.createElement('div');
  pop.className = 'sap-proactive-popup';
  pop.innerHTML = `
    <div class="proactive-header">
      <span>🧠 AI Proactive Insight</span>
      <button onclick="this.closest('.sap-proactive-popup').remove()">✕</button>
    </div>
    <div class="proactive-body">${msg}</div>
    <div class="proactive-actions">
      <button onclick="openChatWithInsight('${chartId}')">💬 Ask AI about this</button>
      <button onclick="this.closest('.sap-proactive-popup').remove()" class="btn-dismiss">Dismiss</button>
    </div>`;
  document.body.appendChild(pop);
  requestAnimationFrame(() => pop.classList.add('show'));
  setTimeout(() => { pop.classList.remove('show'); setTimeout(() => pop.remove(), 400); }, 12000);
}

function openChatWithInsight(chartId) {
  document.querySelector('.sap-proactive-popup')?.remove();
  const label = CHARTS[chartId]?.label || chartId;
  const box = document.getElementById('chatbox-overlay');
  if (!box.classList.contains('visible')) toggleChatbox();
  document.getElementById('ai-input').value = `Give me deeper insights about the ${label} chart`;
}

// ══════════════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════════════
function applyTheme() {
  document.body.classList.toggle('light', isLight);
  const sl = document.querySelector('.theme-slider');
  if (sl) sl.textContent = isLight ? '☀️' : '🌙';
  const sw = document.getElementById('theme-switch');
  if (sw) sw.checked = isLight;
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
}
function toggleTheme() { isLight = !isLight; applyTheme(); refreshAll(); }

function chartColors() {
  return {
    font:    isLight ? '#1E2A4A' : '#EAF0FA',
    grid:    isLight ? 'rgba(30,58,138,0.12)' : 'rgba(249,168,212,0.18)',
    plotBg:  isLight ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.02)',
    land:    isLight ? 'rgba(200,210,230,0.5)'  : 'rgba(30,27,75,0.6)',
    ocean:   isLight ? 'rgba(230,240,255,0.6)'  : 'rgba(13,13,26,0.8)',
  };
}
function patchLayout(layout) {
  const c = chartColors();
  layout.paper_bgcolor = 'rgba(0,0,0,0)';
  layout.plot_bgcolor  = c.plotBg;
  layout.font = Object.assign(layout.font || {}, { color: c.font, family: 'Inter' });
  if (layout.xaxis) layout.xaxis.gridcolor = c.grid;
  if (layout.yaxis) layout.yaxis.gridcolor = c.grid;
  if (layout.geo) {
    layout.geo.landcolor  = c.land;
    layout.geo.oceancolor = c.ocean;
    layout.geo.bgcolor    = 'rgba(0,0,0,0)';
  }
  return layout;
}

// ══════════════════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════════════════
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const tabBtn = document.querySelector(`[data-tab="${name}"]`);
  const tabPanel = document.getElementById('tab-' + name);
  if (tabBtn) tabBtn.classList.add('active');
  if (tabPanel) tabPanel.classList.add('active');
  if (name === 'forecast' && !window._forecastLoaded) loadForecast();
  const s = _st(); s.activeTab = name; _sv(s);
  // Re-observe newly visible charts for proactive insights
  setTimeout(_observeChartsForProactive, 300);
}

// ══════════════════════════════════════════════════════
//  FILTERS
// ══════════════════════════════════════════════════════
function getFilters() {
  return {
    store: document.getElementById('store-filter').value,
    month: document.getElementById('month-filter').value,
  };
}
async function loadMonths() {
  const r = await fetch(API + '/api/months');
  const months = await r.json();
  const sel = document.getElementById('month-filter');
  sel.innerHTML = months
    .map(m => `<option value="${m}">${m === 'All' ? 'All Months' : m}</option>`)
    .join('');
}

function refreshAll() {
  const f = getFilters();
  const qs = `?store=${f.store}&month=${f.month}`;
  const storeLabel = f.store === 'All' ? 'All Stores' : `Store ${f.store}`;
  const monthLabel = f.month === 'All' ? 'All Months' : f.month;
  document.getElementById('filter-info').textContent = `${storeLabel} · ${monthLabel}`;

  loadKPI(qs); loadStoreCompare(qs); loadTrend(qs); loadCategories(qs);
  loadCustomers(qs); loadCustomerValueSegments(qs); loadGeo(qs);
  loadPatterns(qs); loadFilmUtilization(qs);

  window._forecastLoaded = false;
  setTimeout(() => {
    document.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.Plots.resize(el));
    // Re-apply any chart type overrides after data loads
    setTimeout(_reapplyChartTypes, 1500);
  }, 1500);
}

// ══════════════════════════════════════════════════════
//  KPI
// ══════════════════════════════════════════════════════
async function loadKPI(qs) {
  const r = await fetch(API + '/api/kpi' + qs);
  const d = await r.json();
  const items = [
    ['💰', 'Total Revenue',    '$' + d.revenue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}), 'From all payments'],
    ['👥', 'Customers',        d.customers.toLocaleString(), 'Unique renters'],
    ['🎬', 'Total Rentals',    d.rentals.toLocaleString(),   'Transactions'],
    ['📦', 'Inventory Items',  d.inventory.toLocaleString(), 'Physical units'],
    ['🎞️','Film Titles',       d.films.toLocaleString(),     'Unique titles'],
    ['💳', 'Avg Transaction',  '$' + d.avg_tx.toFixed(2),    'Revenue / rental'],
  ];
  const row = document.getElementById('kpi-row');
  row.innerHTML = items.map(([icon, lbl, val, sub]) => {
    const id = 'kpi-' + lbl.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `<div class="kpi-card" id="${id}">
       <div class="kpi-icon">${icon}</div>
       <div class="kpi-label">${lbl}</div>
       <div class="kpi-value">${val}</div>
       <div class="kpi-delta">${sub}</div>
     </div>`;
  }).join('');
  // DOM was replaced — reset drag flag, restore saved order, re-init drag
  delete row._kpiDragInited;
  _restoreKpiOrder();
  _initKpiDrag();
}

// ══════════════════════════════════════════════════════
//  STORE COMPARE — FIXED: always passes both stores in data
// ══════════════════════════════════════════════════════
async function loadStoreCompare(qs) {
  const r = await fetch(API + '/api/store_compare' + qs);
  const d = await r.json();
  // Cache raw data for type switching
  window._chartDataCache['chart-store-rev']  = { rawData: d.revenue_chart.data, rawLayout: d.revenue_chart.layout, xField:'store_id', yField:'revenue', apiData: d.data };
  window._chartDataCache['chart-store-rent'] = { rawData: d.rentals_chart.data, rawLayout: d.rentals_chart.layout, xField:'store_id', yField:'rentals', apiData: d.data };

  _renderChartWithType('chart-store-rev',  d.revenue_chart.data,  d.revenue_chart.layout,  d.data);
  _renderChartWithType('chart-store-rent', d.rentals_chart.data,  d.rentals_chart.layout,  d.data);
}

// ══════════════════════════════════════════════════════
//  TREND
// ══════════════════════════════════════════════════════
async function loadTrend(qs) {
  const r = await fetch(API + '/api/trend' + qs);
  const d = await r.json();
  const _ttRev  = document.getElementById('trend-type-rev');
  const _ttRent = document.getElementById('trend-type-rent');
  if (_ttRev)  _ttRev.textContent  = d.trend_type;
  if (_ttRent) _ttRent.textContent = d.trend_type;
  window._chartDataCache['chart-trend-rev']  = { rawData: d.revenue_chart.data, rawLayout: d.revenue_chart.layout };
  window._chartDataCache['chart-trend-rent'] = { rawData: d.rentals_chart.data, rawLayout: d.rentals_chart.layout };
  _renderChartWithType('chart-trend-rev',  d.revenue_chart.data,  d.revenue_chart.layout);
  _renderChartWithType('chart-trend-rent', d.rentals_chart.data,  d.rentals_chart.layout);
}

// ══════════════════════════════════════════════════════
//  CATEGORIES
// ══════════════════════════════════════════════════════
async function loadCategories(qs) {
  const r = await fetch(API + '/api/categories' + qs);
  const d = await r.json();
  window._chartDataCache['chart-top-cat'] = { rawData: d.top5_chart.data, rawLayout: d.top5_chart.layout, apiData: d.data };
  window._chartDataCache['chart-cat-pie'] = { rawData: d.pie_chart.data,  rawLayout: d.pie_chart.layout,  apiData: d.data };
  window._chartDataCache['chart-rev-inv'] = { rawData: d.rev_per_inv_chart.data, rawLayout: d.rev_per_inv_chart.layout, apiData: d.data };
  _renderChartWithType('chart-top-cat', d.top5_chart.data,        d.top5_chart.layout);
  _renderChartWithType('chart-cat-pie', d.pie_chart.data,         d.pie_chart.layout);
  _renderChartWithType('chart-rev-inv', d.rev_per_inv_chart.data, d.rev_per_inv_chart.layout);
  if (d.data && d.data.length > 0) {
    const top = d.data[0];
    document.getElementById('overview-insight').innerHTML =
      `📌 <strong>Key Insight:</strong> <strong>${top.category}</strong> leads with
       <strong>$${Number(top.revenue).toLocaleString()}</strong> revenue from
       <strong>${Number(top.rentals).toLocaleString()}</strong> rentals
       ($${top.rev_per_inv} per inventory unit).`;
  }
}

// ══════════════════════════════════════════════════════
//  FILM UTILISATION
// ══════════════════════════════════════════════════════
async function loadFilmUtilization(qs) {
  const r = await fetch(API + '/api/film_utilization' + qs);
  const data = await r.json();
  if (!data || !data.length) return;
  let html = `<table class="data-table">
    <thead><tr><th>#</th><th>Film</th><th>Category</th><th>Copies</th><th>Rentals</th><th>Util Rate</th><th>Revenue</th></tr></thead>
    <tbody>`;
  data.forEach((f, i) => {
    const barW = Math.min(100, (f.util_rate / 30) * 100).toFixed(1);
    html += `<tr>
      <td>${i+1}</td><td>${f.title}</td>
      <td><span class="badge">${f.category}</span></td>
      <td>${f.copies}</td><td>${f.times_rented}</td>
      <td><div class="util-bar-wrap"><div class="util-bar" style="width:${barW}%"></div><span>${f.util_rate}×</span></div></td>
      <td>$${Number(f.revenue).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('film-util-table').innerHTML = html;
}

// ══════════════════════════════════════════════════════
//  CUSTOMERS
// ══════════════════════════════════════════════════════
async function loadCustomers(qs) {
  const r = await fetch(API + '/api/customers' + qs);
  const d = await r.json();
  window._chartDataCache['chart-cust-seg'] = { rawData: d.segment_chart.data, rawLayout: d.segment_chart.layout };
  _renderChartWithType('chart-cust-seg', d.segment_chart.data, d.segment_chart.layout);
  if (d.top_customers && d.top_customers.length) {
    let html = `<table class="data-table">
      <thead><tr><th>#</th><th>Name</th><th>Rentals</th><th>Revenue</th><th>Last Rental</th></tr></thead>
      <tbody>`;
    d.top_customers.forEach((c, i) => {
      html += `<tr><td>${i+1}</td><td>${c.name}</td><td>${c.rentals}</td>
        <td>$${Number(c.revenue).toFixed(2)}</td><td>${c.last_rental}</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('cust-table').innerHTML = html;
  }
}

async function loadCustomerValueSegments(qs) {
  const r = await fetch(API + '/api/customer_value_segments' + qs);
  const d = await r.json();
  window._chartDataCache['chart-cust-val'] = { rawData: d.chart.data, rawLayout: d.chart.layout };
  _renderChartWithType('chart-cust-val', d.chart.data, d.chart.layout);
}

// ══════════════════════════════════════════════════════
//  GEO
// ══════════════════════════════════════════════════════
async function loadGeo(qs) {
  const r = await fetch(API + '/api/geo' + qs);
  const d = await r.json();
  window._chartDataCache['chart-geo-map'] = { rawData: d.map_chart.data, rawLayout: d.map_chart.layout };
  window._chartDataCache['chart-geo-bar'] = { rawData: d.bar_chart.data, rawLayout: d.bar_chart.layout };
  _renderChartWithType('chart-geo-map', d.map_chart.data, d.map_chart.layout);
  _renderChartWithType('chart-geo-bar', d.bar_chart.data, d.bar_chart.layout);
  document.getElementById('geo-insight').innerHTML =
    `🌍 <strong>Geographic Reach:</strong> Revenue spans <strong>${d.total_countries}</strong> countries.
     <strong>${d.top_country}</strong> is the top market at <strong>$${d.top_revenue.toLocaleString()}</strong>.`;
}

// ══════════════════════════════════════════════════════
//  PATTERNS
// ══════════════════════════════════════════════════════
async function loadPatterns(qs) {
  const r = await fetch(API + '/api/patterns' + qs);
  const d = await r.json();
  window._chartDataCache['chart-hourly']     = { rawData: d.hourly_chart.data,    rawLayout: d.hourly_chart.layout };
  window._chartDataCache['chart-avg-dur']    = { rawData: d.avg_dur_chart.data,   rawLayout: d.avg_dur_chart.layout };
  window._chartDataCache['chart-dow']        = { rawData: d.dow_chart.data,       rawLayout: d.dow_chart.layout };
  window._chartDataCache['chart-hourly-rev'] = { rawData: d.hourly_rev_chart.data,rawLayout: d.hourly_rev_chart.layout };
  _renderChartWithType('chart-hourly',     d.hourly_chart.data,     d.hourly_chart.layout);
  _renderChartWithType('chart-avg-dur',    d.avg_dur_chart.data,    d.avg_dur_chart.layout);
  _renderChartWithType('chart-dow',        d.dow_chart.data,        d.dow_chart.layout);
  _renderChartWithType('chart-hourly-rev', d.hourly_rev_chart.data, d.hourly_rev_chart.layout);
  document.getElementById('pattern-insight').innerHTML =
    `⏰ <strong>Peak Hour:</strong> <strong>${d.peak_hour}:00 (${d.peak_hour < 12 ? d.peak_hour+'AM' : (d.peak_hour===12?'12PM':(d.peak_hour-12)+'PM')})</strong> has the most rentals. ` +
    `<strong>${d.peak_day}</strong> is the highest-revenue day of the week. ` +
    `Ask the AI chatbot: <em>"What is our busiest hour and best day for rentals?"</em> for full analysis.`;
}

// ══════════════════════════════════════════════════════
//  SMART CHART RENDERER — applies type override if set
// ══════════════════════════════════════════════════════
function _colorizeTraces(traces, color) {
  return traces.map(trace => {
    const t = JSON.parse(JSON.stringify(trace));
    if (t.type === 'pie' || t.type === 'sunburst') {
      t.marker = t.marker || {};
      t.marker.colors = new Array(100).fill(color);
    } else if (t.mode && t.mode.includes('lines')) {
      t.line = Object.assign({}, t.line, {color});
      t.marker = Object.assign({}, t.marker, {color});
    } else {
      t.marker = Object.assign({}, t.marker, {color});
    }
    return t;
  });
}

function _renderChartWithType(chartId, data, layout, apiData) {
  const el = document.getElementById(chartId);
  if (!el) return;
  if (window._deletedCharts.has(chartId)) return;

  const savedColor = _st().chartColors?.[chartId];
  const coloredData = savedColor ? _colorizeTraces(data, savedColor) : data;

  const override = window._chartTypes[chartId];
  if (override) {
    const converted = _convertTraces(coloredData, override);
    const newLayout = _patchLayoutForType(patchLayout(JSON.parse(JSON.stringify(layout))), override);
    Plotly.react(chartId, converted, newLayout, {responsive:true});
  } else {
    Plotly.react(chartId, coloredData, patchLayout(layout), {responsive:true});
  }
  _addChartToolbar(chartId);
}

function _convertTraces(traces, targetType) {
  const t = targetType.toLowerCase().replace('doughnut','pie').replace('donut','pie').replace('area','scatter');
  // Pie conversion is handled via /api/pie_data in changeChartTypeUI — not needed here
  return traces.map(trace => {
    const nt = Object.assign({}, trace);
    if (trace.type === 'pie') {
      nt.x = trace.labels || trace.x;
      nt.y = trace.values || trace.y;
      delete nt.labels; delete nt.values; delete nt.hole; delete nt.textinfo;
    }
    nt.type = (t === 'line' || t === 'scatter') ? 'scatter' : t;
    if (t === 'line') nt.mode = 'lines+markers';
    else if (t === 'scatter') nt.mode = 'markers';
    if (t === 'bar') delete nt.mode;
    return nt;
  });
}

function _patchLayoutForType(layout, type) {
  const t = type.toLowerCase();
  if (t === 'pie' || t === 'donut' || t === 'doughnut') {
    delete layout.xaxis; delete layout.yaxis; delete layout.barmode;
    layout.showlegend = true;
  }
  return layout;
}

// Re-apply all saved chart type overrides
function _reapplyChartTypes() {
  const s = _st();
  if (s.chartTypes) {
    Object.assign(window._chartTypes, s.chartTypes);
  }
  Object.entries(window._chartTypes).forEach(([id, type]) => {
    if (type === 'pie') {
      changeChartTypeUI(id, 'pie', true);  // async fetch from API
    } else {
      const cache = window._chartDataCache[id];
      if (cache && cache.rawData) {
        _renderChartWithType(id, cache.rawData, cache.rawLayout, cache.apiData);
      }
    }
  });
}

// ══════════════════════════════════════════════════════
//  CHART TOOLBAR (hover overlay per chart)
//  Per-chart: change type, delete, quick insight
// ══════════════════════════════════════════════════════
const _chartTypeOptions = [
  { icon:'📊', label:'Bar',    type:'bar' },
  { icon:'🥧', label:'Pie',    type:'pie' },
  { icon:'📈', label:'Line',   type:'line' },
  { icon:'⚪', label:'Scatter',type:'scatter' },
];

function _addChartToolbar(chartId) {
  const el = document.getElementById(chartId);
  if (!el) return;
  const card = el.closest('.chart-card');
  if (!card || card.querySelector('.chart-toolbar')) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'chart-toolbar';
  toolbar.innerHTML = `
    <div class="chart-toolbar-inner">
      <div class="chart-type-btns">
        ${_chartTypeOptions.map(o =>
          `<button class="ct-btn" title="${o.label}" onclick="changeChartTypeUI('${chartId}','${o.type}')">${o.icon}</button>`
        ).join('')}
      </div>
      <div class="chart-toolbar-divider"></div>
      <button class="ct-btn ct-insight" title="AI Insight" onclick="askChartInsight('${chartId}')">🧠</button>
      <button class="ct-btn ct-del" title="Delete chart" onclick="deleteChart('${chartId}')">🗑️</button>
    </div>`;
  card.style.position = 'relative';
  card.appendChild(toolbar);
}

async function changeChartTypeUI(chartId, newType, silent=false) {
  window._chartTypes[chartId] = newType;
  const s = _st(); s.chartTypes = s.chartTypes||{}; s.chartTypes[chartId] = newType; _sv(s);

  if (newType === 'pie') {
    const store = document.getElementById('store-filter')?.value || 'All';
    const month = document.getElementById('month-filter')?.value || 'All';
    try {
      const r = await fetch(`${API}/api/pie_data?chart_id=${encodeURIComponent(chartId)}&store=${encodeURIComponent(store)}&month=${encodeURIComponent(month)}`);
      const d = await r.json();
      if (d.error) { showToast(d.error, 'warning'); return; }
      const el = document.getElementById(chartId);
      if (!el) return;
      const layout = _patchLayoutForType(patchLayout(JSON.parse(JSON.stringify(d.layout))), 'pie');
      Plotly.react(chartId, d.data, layout, {responsive:true});
      _addChartToolbar(chartId);
      if (!silent) {
        const label = CHARTS[chartId]?.label || chartId;
        showToast(`${label} → Pie chart`, 'success');
        showChangeBar(chartId, `Changed ${label} to Pie`);
      }
    } catch (e) {
      showToast(`Pie chart error: ${e.message}`, 'error');
    }
    return;
  }

  const cache = window._chartDataCache[chartId];
  if (cache && cache.rawData) {
    _renderChartWithType(chartId, cache.rawData, cache.rawLayout, cache.apiData);
    if (!silent) {
      const label = CHARTS[chartId]?.label || chartId;
      showToast(`${label} → ${newType} chart`, 'success');
      showChangeBar(chartId, `Changed ${label} to ${newType}`);
    }
  } else {
    showToast(`Chart data not loaded yet — try after scrolling to it`, 'warning');
  }
}

function askChartInsight(chartId) {
  const label = CHARTS[chartId]?.label || chartId;
  const box = document.getElementById('chatbox-overlay');
  if (!box.classList.contains('visible')) toggleChatbox();
  document.getElementById('ai-input').value = `Analyze and give me 3 key insights for the ${label} chart`;
  aiSend();
}

// ══════════════════════════════════════════════════════
//  CHANGE BAR — Apply / Reject per action
// ══════════════════════════════════════════════════════
let _pendingChange = null;

function showChangeBar(chartId, description, onApply, onReject) {
  let bar = document.getElementById('change-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'change-bar';
    document.body.appendChild(bar);
  }
  _pendingChange = { chartId, onApply, onReject };
  bar.innerHTML = `
    <div class="change-bar-inner">
      <span class="change-bar-icon">✏️</span>
      <span class="change-bar-desc">${description}</span>
      <button class="change-bar-apply" onclick="applyChange()">✅ Apply</button>
      <button class="change-bar-reject" onclick="rejectChange()">✕ Reject</button>
    </div>`;
  bar.classList.add('show');
  // Auto-dismiss after 30s
  clearTimeout(bar._timeout);
  bar._timeout = setTimeout(() => bar.classList.remove('show'), 30000);
}

function applyChange() {
  const bar = document.getElementById('change-bar');
  if (bar) bar.classList.remove('show');
  if (_pendingChange?.onApply) _pendingChange.onApply();
  showToast('Change applied & saved!', 'success');
  _pendingChange = null;
}

function rejectChange() {
  const bar = document.getElementById('change-bar');
  if (bar) bar.classList.remove('show');
  if (_pendingChange) {
    // Revert the chart type
    const { chartId } = _pendingChange;
    if (chartId && window._chartTypes[chartId]) {
      delete window._chartTypes[chartId];
      const s = _st(); if (s.chartTypes) { delete s.chartTypes[chartId]; _sv(s); }
      const cache = window._chartDataCache[chartId];
      if (cache?.rawData) _renderChartWithType(chartId, cache.rawData, cache.rawLayout, cache.apiData);
    }
    if (_pendingChange.onReject) _pendingChange.onReject();
    showToast('Change rejected — reverted!', 'info');
  }
  _pendingChange = null;
}

// ══════════════════════════════════════════════════════
//  DELETE / RESTORE CHARTS
// ══════════════════════════════════════════════════════
function deleteChart(chartId) {
  const label = CHARTS[chartId]?.label || chartId;
  const el = document.getElementById(chartId);
  const card = el?.closest('.chart-card');
  if (!card) return;

  window._deletedCharts.add(chartId);
  const s = _st(); s.deletedCharts = [...window._deletedCharts]; _sv(s);

  card.style.transition = 'all 0.4s ease';
  card.style.opacity = '0';
  card.style.transform = 'scale(0.95)';
  setTimeout(() => { card.style.display = 'none'; }, 400);

  showToast(`${label} deleted. <a href="#" onclick="restoreChart('${chartId}');return false;">Undo</a>`, 'warning', 6000);
  _updateRestoreButton();
}

function restoreChart(chartId) {
  const label = CHARTS[chartId]?.label || chartId;
  window._deletedCharts.delete(chartId);
  const s = _st(); s.deletedCharts = [...window._deletedCharts]; _sv(s);

  const el = document.getElementById(chartId);
  const card = el?.closest('.chart-card');
  if (card) {
    card.style.display = '';
    requestAnimationFrame(() => { card.style.opacity = '1'; card.style.transform = ''; });
    const cache = window._chartDataCache[chartId];
    if (cache?.rawData) {
      setTimeout(() => _renderChartWithType(chartId, cache.rawData, cache.rawLayout, cache.apiData), 200);
    }
  }
  showToast(`${label} restored!`, 'success');
  _updateRestoreButton();
}

function _updateRestoreButton() {
  const btn = document.getElementById('restore-btn');
  if (!btn) return;
  if (window._deletedCharts.size > 0) {
    btn.style.display = 'flex';
    btn.textContent = `↩ Restore (${window._deletedCharts.size})`;
  } else {
    btn.style.display = 'none';
  }
}

function restoreAllCharts() {
  [...window._deletedCharts].forEach(id => restoreChart(id));
}

// ══════════════════════════════════════════════════════
//  DRAG & DROP CHART CARDS
// ══════════════════════════════════════════════════════
let _dragSrc = null;

function _initDragDrop() {
  // Assign stable IDs to grid containers so each grid's order is saved separately
  let gi = 0;
  document.querySelectorAll('[class*="chart-grid"]').forEach(grid => {
    if (!grid.id) grid.id = `cg${gi++}`;
  });
  // Assign stable IDs to cards based on their inner chart element
  document.querySelectorAll('.chart-card').forEach(card => {
    if (!card.id) {
      const inner = card.querySelector('[id]');
      if (inner) card.id = `cc-${inner.id}`;
    }
    _makeDraggable(card);
  });
  _restoreCardOrder();
}

function _makeDraggable(card) {
  if (card._dragInited) return;
  card._dragInited = true;
  card.draggable = true;

  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.innerHTML = '⠿';
  handle.title = 'Drag to reorder';
  card.insertBefore(handle, card.firstChild);

  card.addEventListener('dragstart', e => {
    _dragSrc = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.chart-card').forEach(c => c.classList.remove('drag-over'));
    _dragSrc = null;
    // Resize after drag
    setTimeout(() => document.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.Plots.resize(el)), 200);
  });
  card.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('drag-over');
    if (_dragSrc && _dragSrc !== card) {
      const parent = card.parentNode;
      const srcIdx = [...parent.children].indexOf(_dragSrc);
      const tgtIdx = [...parent.children].indexOf(card);
      if (srcIdx < tgtIdx) parent.insertBefore(_dragSrc, card.nextSibling);
      else parent.insertBefore(_dragSrc, card);
      _saveCardOrder(parent);
      showToast('Chart moved! Layout saved permanently.', 'success', 2000);
    }
  });
}

function _saveCardOrder(container) {
  const ids = [...(container || document).querySelectorAll('.chart-card[id]')]
    .map(c => c.id).filter(Boolean);
  if (ids.length === 0) return;
  const s = _st(); s.cardOrder = s.cardOrder || {};
  s.cardOrder[container?.id || 'root'] = ids;
  _sv(s);
}

function _restoreCardOrder() {
  const s = _st();
  if (!s.cardOrder) return;
  Object.entries(s.cardOrder).forEach(([containerId, order]) => {
    const container = containerId === 'root' ? document : document.getElementById(containerId);
    if (!container) return;
    order.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.appendChild(el);
    });
  });
}

// ══════════════════════════════════════════════════════
//  NaN-safe metric helpers
// ══════════════════════════════════════════════════════
function _fmtMetric(val, fmt) {
  if (val === null || val === undefined || (typeof val === 'number' && isNaN(val))) return '<span class="muted-text">N/A</span>';
  if (fmt === 'r2') return val.toFixed(4);
  if (fmt === 'mape') return val.toFixed(2) + '%';
  return '$' + val.toLocaleString(undefined, {maximumFractionDigits: 2});
}

// ══════════════════════════════════════════════════════
//  FORECAST (Multi-model)
// ══════════════════════════════════════════════════════
// Forecast horizon control
window._forecastHorizon = window._forecastHorizon || 6;

function setForecastHorizon(months) {
  window._forecastHorizon = months;
  window._forecastLoaded = false;
  // Update button states
  document.querySelectorAll('.fh-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.fh-btn[data-months="${months}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  loadForecast();
  showToast(`Forecast horizon set to ${months} month${months > 1 ? 's' : ''}`, 'info', 2000);
}

async function loadForecast() {
  window._forecastLoaded = true;
  const horizon = window._forecastHorizon || 3;
  const status = document.getElementById('forecast-status');
  status.innerHTML = `<span class="spinner"></span> Training models for ${horizon}-month forecast...`;

  try {
    const r = await fetch(API + '/api/forecast?horizon=' + (window._forecastHorizon || 3));
    const d = await r.json();
    if (d.error) { status.innerHTML = `❌ ${d.error}`; return; }

    const {
      months, revenues, future_months,
      tf_future, lstm_future, rf_future, dt_future, lr_future, ma_future,
      xgb_future, arima_future,
      tf_fitted, lstm_fitted, rf_fitted, dt_fitted, lr_fitted,
      metrics, training, confidence, leaderboard, residuals,
    } = d;

    const arch = training.architecture;
    const tfM  = metrics.transformer || {};
    const tfBad = (tfM.r2 != null && tfM.r2 < 0) || (tfM.mape != null && tfM.mape > 50);
    const warns = tfBad ? ` <span style="background:#F59E0B;color:#000;padding:2px 8px;border-radius:4px;font-size:.72rem;font-weight:700">⚠️ Transformer underperforming</span>` : '';
    status.innerHTML = `✅ <strong>${Object.keys(metrics).length}</strong> models trained on <strong>${months.length}</strong> months · Test: <strong>${d.test_size}</strong> month(s)${warns}`;

    document.getElementById('arch-badge').innerHTML =
      `<span class="badge">Transformer: ${arch.params} params</span>
       <span class="badge">LSTM: ${arch.lstm_params} params</span>
       <span class="badge">d_model=${arch.d_model}</span>
       <span class="badge">${arch.heads} heads</span>
       <span class="badge">seq_len=${arch.seq_len}</span>
       <span class="badge">${training.epochs_run} TF epochs</span>
       <span class="badge">${training.lstm_epochs} LSTM epochs</span>`;

    const fittedMonths = months.slice(arch.seq_len);

    const chartTraces = [
      { x: months, y: revenues, name: 'Historical', mode: 'lines+markers',
        line: {color:'#1E3A8A', width:3}, marker: {size:6} },
      { x: fittedMonths, y: tf_fitted, name: 'Transformer Fitted',
        mode: 'lines', line: {color:'#A855F7', width:1.5, dash:'dot'} },
      { x: fittedMonths, y: lstm_fitted, name: 'LSTM Fitted',
        mode: 'lines', line: {color:'#F97316', width:1.5, dash:'dot'} },
      { x: [months.at(-1), ...future_months], y: [revenues.at(-1), ...tf_future],
        name: 'Transformer', mode: 'lines+markers',
        line: {color:'#EC4899', width:2.5, dash:'dash'}, marker: {size:10, symbol:'star'} },
      { x: [months.at(-1), ...future_months], y: [revenues.at(-1), ...lstm_future],
        name: 'LSTM', mode: 'lines+markers',
        line: {color:'#F97316', width:2, dash:'dash'}, marker: {size:7, symbol:'diamond'} },
      { x: [months.at(-1), ...future_months], y: [revenues.at(-1), ...rf_future],
        name: 'Random Forest', mode: 'lines+markers',
        line: {color:'#7DD3FC', width:1.5, dash:'dashdot'}, marker: {size:5} },
      { x: [months.at(-1), ...future_months], y: [revenues.at(-1), ...lr_future],
        name: 'Linear Reg', mode: 'lines+markers',
        line: {color:'#86EFAC', width:1.5, dash:'longdash'}, marker: {size:5} },
    ];
    if (xgb_future && xgb_future.length) {
      chartTraces.push({ x: [months.at(-1), ...future_months], y: [revenues.at(-1), ...xgb_future],
        name: 'XGBoost', mode: 'lines+markers',
        line: {color:'#FBBF24', width:2, dash:'dashdot'}, marker: {size:6} });
    }
    if (arima_future && arima_future.length) {
      chartTraces.push({ x: [months.at(-1), ...future_months], y: [revenues.at(-1), ...arima_future],
        name: 'ARIMA', mode: 'lines+markers',
        line: {color:'#E879F9', width:1.5, dash:'dot'}, marker: {size:5} });
    }

    window._chartDataCache['chart-forecast'] = { rawData: chartTraces, rawLayout: {
      height: 380, margin: {t:20,b:40,l:70,r:20},
      legend: {font:{size:9}, orientation:'h', y:1.15},
      xaxis: {}, yaxis: {tickprefix:'$', tickformat:',.0f'},
    }};
    _renderChartWithType('chart-forecast', chartTraces, window._chartDataCache['chart-forecast'].rawLayout);

    document.getElementById('forecast-cards').innerHTML = future_months.map((m, i) => {
      const v = tf_future[i]; if (v == null) return '';
      const prev = i === 0 ? revenues.at(-1) : tf_future[i-1];
      const delta = prev ? ((v - prev) / Math.abs(prev) * 100) : 0;
      const sym = delta >= 0 ? '▲' : '▼';
      const col = delta >= 0 ? 'var(--ok)' : '#EF4444';
      return `<div class="pred-card">
        <div class="pred-label">${m}</div>
        <div class="pred-val">$${Math.round(v).toLocaleString()}</div>
        <div style="font-size:.72rem;font-weight:700;color:${col};margin:4px 0">${sym} ${Math.abs(delta).toFixed(1)}%</div>
        <div class="muted-text" style="font-size:.62rem">Transformer</div>
      </div>`;
    }).join('');

    // Update section title with current horizon
    const fTitle = document.getElementById('forecast-chart-title');
    if (fTitle) fTitle.textContent = `Historical + Fitted + ${horizon}-Month Forecast`;
    document.getElementById('forecast-detail').innerHTML =
      `🔮 <strong>Transformer</strong> predicts ${tf_future.map(v => '<strong>$' + Math.round(v).toLocaleString() + '</strong>').join(' → ')} for the next ${horizon} month${horizon > 1 ? 's' : ''}.`;

    const compTraces = [
      {x:future_months, y:tf_future.map(Math.round),   name:'Transformer',  type:'bar', marker:{color:'#EC4899'}},
      {x:future_months, y:lstm_future.map(Math.round),  name:'LSTM',         type:'bar', marker:{color:'#F97316'}},
      {x:future_months, y:rf_future.map(Math.round),   name:'Random Forest', type:'bar', marker:{color:'#7DD3FC'}},
      {x:future_months, y:dt_future.map(Math.round),   name:'Decision Tree', type:'bar', marker:{color:'#FDE68A'}},
      {x:future_months, y:lr_future.map(Math.round),   name:'Linear Reg',    type:'bar', marker:{color:'#86EFAC'}},
      {x:future_months, y:ma_future.map(Math.round),   name:'Moving Avg',    type:'bar', marker:{color:'#C4B5FD'}},
    ];
    if (xgb_future && xgb_future.length) compTraces.push({x:future_months, y:xgb_future.map(Math.round), name:'XGBoost', type:'bar', marker:{color:'#FBBF24'}});
    if (arima_future && arima_future.length) compTraces.push({x:future_months, y:arima_future.map(Math.round), name:'ARIMA', type:'bar', marker:{color:'#E879F9'}});
    Plotly.react('chart-comparison', compTraces, patchLayout({
      barmode:'group', height:300, margin:{t:20,b:40,l:70,r:20},
      legend:{font:{size:9}}, xaxis:{}, yaxis:{tickprefix:'$', tickformat:',.0f'},
    }), {responsive:true});

    let tbl = `<table class="data-table">
      <thead><tr><th>Month</th><th>Transformer</th><th>LSTM</th><th>RF</th><th>DT</th><th>LR</th><th>MA</th>`;
    if (xgb_future.length) tbl += '<th>XGB</th>';
    if (arima_future.length) tbl += '<th>ARIMA</th>';
    tbl += '</tr></thead><tbody>';
    future_months.forEach((m, i) => {
      tbl += `<tr><td>${m}</td>
        <td>$${Math.round(tf_future[i]).toLocaleString()}</td>
        <td>$${Math.round(lstm_future[i]).toLocaleString()}</td>
        <td>$${Math.round(rf_future[i]).toLocaleString()}</td>
        <td>$${Math.round(dt_future[i]).toLocaleString()}</td>
        <td>$${Math.round(lr_future[i]).toLocaleString()}</td>
        <td>$${Math.round(ma_future[i]).toLocaleString()}</td>`;
      if (xgb_future.length) tbl += `<td>$${Math.round(xgb_future[i]).toLocaleString()}</td>`;
      if (arima_future.length) tbl += `<td>$${Math.round(arima_future[i]).toLocaleString()}</td>`;
      tbl += '</tr>';
    });
    tbl += '</tbody></table>';
    document.getElementById('comparison-table').innerHTML = tbl;

    // ── Model Accuracy Leaderboard ─────────────────────
    const lbEl = document.getElementById('model-leaderboard');
    if (lbEl && leaderboard && leaderboard.length) {
      const modelInfo = {
        transformer:       { icon:'🔷', note:'Deep learning (academic req.)', color:'#A855F7' },
        lstm:              { icon:'🔶', note:'Deep learning sequential',       color:'#F97316' },
        random_forest:     { icon:'🌲', note:'Ensemble tree method',           color:'#7DD3FC' },
        xgboost:           { icon:'⚡', note:'Gradient boosting (recommended)',color:'#FBBF24' },
        linear_regression: { icon:'📈', note:'Ridge regression (recommended)', color:'#86EFAC' },
        decision_tree:     { icon:'🌿', note:'Single decision tree',           color:'#FDE68A' },
        moving_average:    { icon:'〰️', note:'Weighted moving average',        color:'#C4B5FD' },
        arima:             { icon:'📊', note:'Classical time-series (recommended)', color:'#E879F9' },
      };
      let lbTbl = `<table class="data-table">
        <thead><tr>
          <th>Rank</th><th>Model</th><th>MAE ↓</th><th>RMSE ↓</th>
          <th>MAPE ↓</th><th>R² ↑</th><th>Notes</th>
        </tr></thead><tbody>`;
      leaderboard.forEach((m, i) => {
        const info = modelInfo[m.model] || { icon:'🔹', note:'', color:'#94A3B8' };
        const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
        const na = v => (v != null && !isNaN(v)) ? v : '<span class="muted-text">N/A</span>';
        const highlight = i === 0 ? 'background:rgba(134,239,172,0.08);font-weight:600' : '';
        lbTbl += `<tr style="${highlight}">
          <td>${rank}</td>
          <td><span style="color:${info.color}">${info.icon}</span> ${m.model.replace(/_/g,' ')}</td>
          <td>${m.mae != null ? '$'+m.mae.toFixed(0) : na(null)}</td>
          <td>${m.rmse != null ? '$'+m.rmse.toFixed(0) : na(null)}</td>
          <td>${m.mape != null ? m.mape.toFixed(1)+'%' : na(null)}</td>
          <td>${m.r2 != null ? m.r2.toFixed(3) : na(null)}</td>
          <td style="font-size:.72rem;color:#94A3B8">${info.note}</td>
        </tr>`;
      });
      lbTbl += '</tbody></table>';
      lbTbl += `<p style="font-size:.72rem;color:#94A3B8;margin-top:8px">
        ⚠️ Metrics computed on holdout test set (last ${d.test_size} month${d.test_size !== 1 ? 's' : ''}). With only ${months.length} months of data,
        <strong style="color:#86EFAC">Linear Regression, XGBoost, and ARIMA</strong> typically achieve lower error than deep learning models.
        The <strong style="color:#A855F7">Transformer</strong> is included as per academic requirement — it demonstrates time-series attention mechanisms
        and would likely outperform simpler models with 24+ months of data.
      </p>`;
      lbEl.innerHTML = lbTbl;
    }

    // ── Trigger AI-powered ML prediction ──────────────
    if (d.ai_context) {
      generateAiMlPrediction(d.ai_context, d);
    }

  } catch (e) {
    document.getElementById('forecast-status').innerHTML = `❌ Error: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════
//  AI INSIGHTS CENTER
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  AI-POWERED ML PREDICTION (Claude interprets ML results)
// ══════════════════════════════════════════════════════
async function generateAiMlPrediction(aiCtx, forecastData) {
  const spinner = document.getElementById('ai-pred-spinner');
  const content = document.getElementById('ai-pred-content');
  if (!spinner || !content) return;
  spinner.style.display = 'inline-block';
  content.innerHTML = '<em style="color:#94A3B8;">AI is analyzing ML forecast results...</em>';

  const { best_model, best_future, ensemble, last_revenue, avg_revenue,
          revenue_trend, horizon, future_months } = aiCtx;

  const lb = forecastData?.leaderboard || [];
  const lbSummary = lb.slice(0,6).map((m,i) => {
    const mae  = m.mae  != null ? `$${m.mae.toFixed(0)}`  : 'N/A';
    const mape = m.mape != null ? `${m.mape.toFixed(1)}%`  : 'N/A';
    const r2   = m.r2   != null ? m.r2.toFixed(3)          : 'N/A';
    return `#${i+1} ${m.model}: MAE=${mae}, MAPE=${mape}, R2=${r2}`;
  }).join('\n');

  const fmt = (arr) => (arr||[]).map((v,i)=>`${(future_months||[])[i]||''}: $${Math.round(v).toLocaleString()}`).join(', ');
  const tfStr    = fmt(forecastData?.tf_future);
  const lrStr    = fmt(forecastData?.lr_future);
  const xgbStr   = fmt(forecastData?.xgb_future);
  const arimaStr = fmt(forecastData?.arima_future);
  const ensStr   = fmt(ensemble || forecastData?.confidence?.ensemble);
  const changePercent = ensemble?.length ? (((ensemble.at(-1)-last_revenue)/last_revenue)*100).toFixed(1) : null;

  const prompt = `You are a senior data scientist interpreting ML revenue forecasts for a DVD rental store dashboard.

BUSINESS CONTEXT: DVD rental. Data: May 2005 to Feb 2006 (9 months). 2 stores. Predictions = months after Feb 2006.
LAST REVENUE: $${Math.round(last_revenue).toLocaleString()} | AVG: $${Math.round(avg_revenue).toLocaleString()} | TREND: ${revenue_trend}
HORIZON: ${horizon} months

MODEL LEADERBOARD (lower MAE = better accuracy):
${lbSummary || '(no test metrics — insufficient data for holdout)'}

ALL MODEL FORECASTS:
Transformer: ${tfStr}
Linear Regression: ${lrStr}
${xgbStr ? 'XGBoost: ' + xgbStr : ''}
${arimaStr ? 'ARIMA: ' + arimaStr : ''}
Ensemble average: ${ensStr}
${changePercent ? 'Total change over ' + horizon + ' months: ' + changePercent + '%' : ''}

KEY CONTEXT:
- 9 months is a small dataset. Simpler models (Linear Regression, XGBoost, ARIMA) tend to outperform deep learning on small datasets.
- Transformer is included per academic requirement to demonstrate deep learning time-series architecture.
- In production with 24+ months data, Transformer and LSTM would likely be competitive.

Write a concise AI report (5-7 sentences) covering:
1. Best model and its prediction (cite MAE/MAPE if available)
2. Overall trend direction and expected revenue range
3. Note on Transformer: academically included; simpler models often win on small datasets
4. One business recommendation based on the forecast
5. One key caveat or uncertainty

Use **bold** for key numbers. Be direct and professional.`;

  try {
    const resp = await fetch(API + '/api/agent', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ prompt, history: [], model: document.getElementById('ai-model')?.value || 'llama-3.3-70b-versatile' })
    });
    const data = await resp.json();
    const text = data.response || data.error || 'Unable to generate prediction.';
    content.innerHTML = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .split('\n').filter(l => l.trim())
      .map(l => `<p style="margin:0 0 6px 0">${l}</p>`).join('');
  } catch (err) {
    content.innerHTML = `<em style="color:#F87171;">AI unavailable: ${err.message}. Check Flask server + API key in .env</em>`;
  } finally {
    spinner.style.display = 'none';
  }
}


async function generateInsight(type) {
  const output = document.getElementById('ai-insight-output');
  const toolsEl = document.getElementById('ai-insight-tools');
  output.innerHTML = `<div style="text-align:center;padding:40px"><span class="spinner"></span> AI Agent is analysing data...</div>`;
  toolsEl.style.display = 'none';

  const prompts = {
    executive_summary: "Generate a comprehensive executive summary of the DVD rental business. Include: total revenue, customer count, rental trends, store comparison, top categories, geographic reach, and 5 strategic recommendations. Use real data only.",
    anomaly_detection: "Analyze the DVD rental data for anomalies. Check: months with unusual revenue, categories with disproportionate performance, customer segments with irregular behavior, stores with significant gaps. Flag each anomaly with severity and business impact.",
    recommendation: "Based on the DVD rental data, generate 7 specific, actionable recommendations to improve business performance. For each: state the insight, the recommended action, expected impact, and implementation priority. Use real numbers.",
    trend_analysis: "Perform deep trend analysis on DVD rental revenue and rental patterns. Analyze: monthly growth rates, seasonal patterns, store-level trends, category momentum, customer acquisition patterns. Include specific numbers.",
    forecast_explanation: "Explain the revenue forecast results in plain business English. Compare the Transformer, LSTM, Random Forest, and other models. Which should the business trust? Why?",
    segment_analysis: "Analyze customer segments in the DVD rental business. Break down: Elite vs Frequent vs Regular vs Casual customers. Revenue contribution, rental frequency, retention signals. Suggest targeted strategies for each segment.",
  };

  try {
    const r = await fetch(API + '/api/ai_chat', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ prompt: prompts[type] || prompts.executive_summary,
        history: [], model: document.getElementById('ai-model').value,
        store: document.getElementById('store-filter')?.value || 'All',
        month: document.getElementById('month-filter')?.value || 'All' }),
    });
    const d = await r.json();
    if (d.error) { output.innerHTML = `<p style="color:#EF4444">⚠️ ${d.error}</p>`; return; }
    const html = typeof marked !== 'undefined' ? marked.parse(d.response) : d.response;
    output.innerHTML = `<div class="ai-insight-content">${html}</div>`;
  } catch (e) {
    output.innerHTML = `<p style="color:#EF4444">⚠️ ${e.message}</p>`;
  }
}

// ══════════════════════════════════════════════════════
//  CHATBOT (Unified AI Agent)
// ══════════════════════════════════════════════════════
function toggleChatbox() {
  const box = document.getElementById('chatbox-overlay');
  const fab = document.getElementById('chat-fab');
  box.classList.toggle('visible');
  fab.classList.toggle('open');
  if (box.classList.contains('visible')) renderChat();
}

// Draggable chatbox
(function initDrag() {
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.getElementById('chatbox-drag-bar');
    const box = document.getElementById('chatbox-overlay');
    if (!bar || !box) return;
    let dragging = false, startX, startY, startLeft, startTop;
    bar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.chatbox-drag-close')) return;
      dragging = true;
      const rect = box.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      box.style.transition = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      box.style.left = (startLeft + e.clientX - startX) + 'px';
      box.style.top  = (startTop  + e.clientY - startY) + 'px';
      box.style.right = 'auto'; box.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; box.style.transition = ''; });
  });
})();

function detectTopics(prompt) {
  const p = prompt.toLowerCase();
  const map = [
    ['revenue|sales|income|payment',   '📊 Revenue'], ['customer|retention|segment', '👥 Customers'],
    ['film|movie|category|inventory',   '📦 Inventory'], ['store|compare|location', '🏪 Stores'],
    ['forecast|predict|future|trend',   '🔮 Forecast'], ['country|geo|region', '🌍 Geo'],
    ['hour|day|pattern|peak',          '⏱️ Patterns'], ['recommend|strategy|grow', '💡 Strategy'],
    ['edit|modify|change|add|create|style|color|design', '✏️ Code Edit'],
    ['delete|remove|hide|hapus|sembunyikan', '🗑️ Layout'],
    ['chart|bar|pie|line|scatter',     '📊 Chart Type'],
  ];
  const found = map.filter(([kw]) => new RegExp(kw).test(p)).map(([, label]) => label);
  return found.length ? found : ['🔍 Analysis'];
}

// ════════ LOOKUP TABLES ════════════════════════════════

const THEMES = {
  'default':     { grad:'linear-gradient(135deg,#0A1628 0%,#142347 50%,#1B1733 100%)', bg:'#0A1628', bg2:'#142347', accent:'#EC4899', soft:'#F9A8D4', navy:'#1E3A8A' },
  'dark navy':   { grad:'linear-gradient(135deg,#0a1628 0%,#0d2050 50%,#0a1835 100%)', bg:'#0a1628', bg2:'#0d2050', accent:'#60a5fa', soft:'#93c5fd', navy:'#3b82f6' },
  'purple gold': { grad:'linear-gradient(135deg,#1a0a2e 0%,#2d1652 50%,#1a1040 100%)', bg:'#1a0a2e', bg2:'#2d1652', accent:'#eab308', soft:'#fde047', navy:'#a855f7' },
  'ocean':       { grad:'linear-gradient(135deg,#0c1922 0%,#0f2535 50%,#0a1f18 100%)', bg:'#0c1922', bg2:'#0f2535', accent:'#06b6d4', soft:'#67e8f9', navy:'#10b981' },
  'purple':      { grad:'linear-gradient(135deg,#1a0a2e 0%,#2d1652 50%,#200a40 100%)', bg:'#1a0a2e', bg2:'#2d1652', accent:'#a855f7', soft:'#d8b4fe', navy:'#7c3aed' },
  'midnight':    { grad:'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)', bg:'#0f0c29', bg2:'#302b63', accent:'#c77dff', soft:'#e0aaff', navy:'#7b2d8b' },
  'sunset':      { grad:'linear-gradient(135deg,#1a0533 0%,#370a3d 50%,#1a0a00 100%)', bg:'#1a0533', bg2:'#370a3d', accent:'#ff6b35', soft:'#ffa07a', navy:'#d63031' },
  'green':       { grad:'linear-gradient(135deg,#0a1f0a 0%,#0d3b1e 50%,#0a1a10 100%)', bg:'#0a1f0a', bg2:'#0d3b1e', accent:'#22c55e', soft:'#86efac', navy:'#16a34a' },
  'red':         { grad:'linear-gradient(135deg,#1a0505 0%,#3b0d0d 50%,#200808 100%)', bg:'#1a0505', bg2:'#3b0d0d', accent:'#ef4444', soft:'#fca5a5', navy:'#dc2626' },
  'black':       { grad:'linear-gradient(135deg,#000 0%,#0a0a0a 50%,#111 100%)',       bg:'#000000', bg2:'#0a0a0a', accent:'#ec4899', soft:'#f9a8d4', navy:'#1e3a8a' },
  'slate':       { grad:'linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%)', bg:'#0f172a', bg2:'#1e293b', accent:'#38bdf8', soft:'#7dd3fc', navy:'#0284c7' },
  'forest':      { grad:'linear-gradient(135deg,#052e16 0%,#14532d 50%,#052e16 100%)', bg:'#052e16', bg2:'#14532d', accent:'#4ade80', soft:'#86efac', navy:'#16a34a' },
};

const ACCENTS = {
  green:   { v:'#22c55e', s:'#86efac' }, hijau: { v:'#22c55e', s:'#86efac' },
  blue:    { v:'#3b82f6', s:'#93c5fd' }, biru:  { v:'#3b82f6', s:'#93c5fd' },
  orange:  { v:'#f97316', s:'#fdba74' }, oranye:{ v:'#f97316', s:'#fdba74' },
  red:     { v:'#ef4444', s:'#fca5a5' }, merah: { v:'#ef4444', s:'#fca5a5' },
  yellow:  { v:'#eab308', s:'#fde047' }, kuning:{ v:'#eab308', s:'#fde047' },
  gold:    { v:'#eab308', s:'#fde047' }, emas:  { v:'#eab308', s:'#fde047' },
  purple:  { v:'#a855f7', s:'#d8b4fe' }, ungu:  { v:'#a855f7', s:'#d8b4fe' },
  pink:    { v:'#ec4899', s:'#f9a8d4' },
  cyan:    { v:'#06b6d4', s:'#67e8f9' }, teal:  { v:'#06b6d4', s:'#67e8f9' },
  white:   { v:'#f1f5f9', s:'#e2e8f0' }, putih: { v:'#f1f5f9', s:'#e2e8f0' },
};

const CHARTS = {
  'chart-store-rev':   { tab:'overview',   label:'Store Revenue',              section:'Store Revenue' },
  'chart-store-rent':  { tab:'overview',   label:'Store Rentals',              section:'Store Rentals' },
  'chart-trend-rev':   { tab:'overview',   label:'Monthly Revenue Trend',      section:'Monthly Revenue Trend' },
  'chart-trend-rent':  { tab:'overview',   label:'Monthly Rentals Trend',      section:'Monthly Rentals Trend' },
  'chart-top-cat':     { tab:'inventory',  label:'Top Categories',             section:'Top Categories by Revenue' },
  'chart-cat-pie':     { tab:'inventory',  label:'Category Rental Share',      section:'Category Rental Share' },
  'chart-rev-inv':     { tab:'inventory',  label:'Revenue per Inventory',      section:'Revenue per Inventory Unit' },
  'chart-cust-seg':    { tab:'overview',   label:'Customer Distribution',      section:'Customer Distribution' },
  'chart-cust-val':    { tab:'customers',  label:'Customer Value Segments',    section:'Customer Value Segments' },
  'chart-geo-map':     { tab:'customers',  label:'Global Revenue Map',         section:'Global Revenue Distribution' },
  'chart-geo-bar':     { tab:'customers',  label:'Top Countries',              section:'Top 10 Countries by Revenue' },
  'chart-hourly':      { tab:'patterns',   label:'Hourly Rental Activity',     section:'Hourly Rental Activity' },
  'chart-avg-dur':     { tab:'patterns',   label:'Avg Rental Duration',        section:'Avg Rental Duration by Day' },
  'chart-dow':         { tab:'patterns',   label:'Revenue by Day of Week',     section:'Revenue by Day of Week' },
  'chart-hourly-rev':  { tab:'patterns',   label:'Revenue by Hour',            section:'Revenue by Hour' },
  'chart-forecast':    { tab:'forecast',   label:'Revenue Forecast',           section:'Forecast' },
};

const CHART_ALIASES = {
  'store revenue':'chart-store-rev', 'store rev':'chart-store-rev', 'revenue store':'chart-store-rev',
  'store rental':'chart-store-rent', 'store rent':'chart-store-rent', 'rentals store':'chart-store-rent',
  'revenue trend':'chart-trend-rev', 'monthly revenue':'chart-trend-rev', 'revenue monthly':'chart-trend-rev',
  'rental trend':'chart-trend-rent', 'monthly rental':'chart-trend-rent', 'monthly rentals':'chart-trend-rent',
  'top categories':'chart-top-cat', 'top category':'chart-top-cat', 'categories revenue':'chart-top-cat',
  'category revenue':'chart-top-cat', 'category pie':'chart-cat-pie', 'category share':'chart-cat-pie',
  'rental share':'chart-cat-pie', 'revenue per inventory':'chart-rev-inv', 'rev per inv':'chart-rev-inv',
  'customer distribution':'chart-cust-seg', 'customer dist':'chart-cust-seg', 'customer segment':'chart-cust-seg',
  'customer value':'chart-cust-val', 'value segment':'chart-cust-val',
  'global revenue':'chart-geo-map', 'global map':'chart-geo-map', 'world map':'chart-geo-map',
  'revenue map':'chart-geo-map', 'geo map':'chart-geo-map', 'global revenue distribution':'chart-geo-map',
  'country revenue':'chart-geo-bar', 'top countries':'chart-geo-bar', 'countries bar':'chart-geo-bar',
  'geo bar':'chart-geo-bar', 'hourly rental':'chart-hourly', 'hourly activity':'chart-hourly',
  'rental activity':'chart-hourly', 'hourly':'chart-hourly', 'avg duration':'chart-avg-dur',
  'rental duration':'chart-avg-dur', 'duration':'chart-avg-dur', 'day of week':'chart-dow',
  'revenue dow':'chart-dow', 'dow':'chart-dow', 'hourly revenue':'chart-hourly-rev',
  'revenue hour':'chart-hourly-rev', 'revenue by hour':'chart-hourly-rev',
  'forecast':'chart-forecast', 'prediction':'chart-forecast',
};

const TABS = {
  overview:    ['overview','home','beranda','main'],
  inventory:   ['inventory','inventori','stock','film','category','kategori'],
  customers:   ['customers','customer','pelanggan','geo','region','geography','map','negara','country'],
  patterns:    ['patterns','pattern','pola','hourly','hour','jam','waktu','day','hari'],
  forecast:    ['forecast','prediksi','prediction','predic','future','masa depan'],
  'ai-insights':['ai','insight','analisis','analysis','executive','summary'],
  settings:    ['settings','setting','pengaturan','config'],
};

// ══════════════════════════════════════════════════════
//  PERSIST HELPERS
// ══════════════════════════════════════════════════════
function _css(k, v, save=true) {
  document.documentElement.style.setProperty(k, v);
  if (save) { const s=_st(); s.css=s.css||{}; s.css[k]=v; _sv(s); }
}
function _bg(grad, save=true) {
  document.body.style.background = grad;
  if (save) { const s=_st(); s.bg=grad; _sv(s); }
}
function _theme(cfg, save=true) {
  if (cfg.grad) _bg(cfg.grad, save);
  if (cfg.bg)   { _css('--bg', cfg.bg, save); _css('--bg2', cfg.bg2||cfg.bg, save); }
  if (cfg.accent) { _css('--pink-hot',cfg.accent,save); _css('--accent',cfg.accent,save); _css('--pink',cfg.soft||cfg.accent,save); }
  if (cfg.navy)  _css('--navy', cfg.navy, save);
  if (cfg.text)  { _css('--text',cfg.text,save); _css('--muted',cfg.muted||'#9ab0d1',save); }
  if (save) { const s=_st(); s.theme=cfg; _sv(s); }
}
function _kpiPos(pos, save=true) {
  const ov = document.getElementById('tab-overview');
  const kp = document.getElementById('kpi-row');
  if (!ov||!kp) return false;
  if (pos === 'bottom') {
    kp.style.flexDirection = '';
    kp.style.flexWrap = '';
    ov.appendChild(kp);
  } else if (pos === 'top') {
    kp.style.flexDirection = '';
    kp.style.flexWrap = '';
    ov.insertBefore(kp, ov.firstChild);
  }
  if (save) { const s=_st(); s.kpiPos=pos; _sv(s); }
  return true;
}

function _saveKpiOrder() {
  const row = document.getElementById('kpi-row');
  if (!row) return;
  const ids = [...row.querySelectorAll('.kpi-card[id]')].map(c => c.id).filter(Boolean);
  if (!ids.length) return;
  const s = _st(); s.kpiOrder = ids; _sv(s);
}

function _restoreKpiOrder() {
  const s = _st();
  if (!s.kpiOrder?.length) return;
  const row = document.getElementById('kpi-row');
  if (!row) return;
  s.kpiOrder.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentNode === row) row.appendChild(el);
  });
}

// Make KPI cards individually draggable left/right within the row
function _initKpiDrag() {
  const row = document.getElementById('kpi-row');
  if (!row || row._kpiDragInited) return;
  row._kpiDragInited = true;
  let dragSrc = null;
  row.querySelectorAll('.kpi-card').forEach(card => {
    card.draggable = true;
    card.style.cursor = 'grab';
    card.addEventListener('dragstart', e => {
      dragSrc = card;
      card.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '';
      dragSrc = null;
      row.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('kpi-drag-over'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('kpi-drag-over'));
      card.classList.add('kpi-drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('kpi-drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('kpi-drag-over');
      if (dragSrc && dragSrc !== card) {
        const parent = card.parentNode;
        const srcIdx = [...parent.children].indexOf(dragSrc);
        const tgtIdx = [...parent.children].indexOf(card);
        if (srcIdx < tgtIdx) parent.insertBefore(dragSrc, card.nextSibling);
        else parent.insertBefore(dragSrc, card);
        _saveKpiOrder();
        showToast('KPI card moved! Layout saved permanently.', 'success', 1500);
      }
    });
  });
}
function _vis(id, show, save=true) {
  const el = document.getElementById(id)||document.querySelector(id);
  if (!el) return false;
  el.style.display = show ? '' : 'none';
  if (save) { const s=_st(); s.hidden=s.hidden||[]; s.hidden=s.hidden.filter(x=>x!==id); if(!show)s.hidden.push(id); _sv(s); }
  return true;
}
function _nav(tab, save=true) {
  switchTab(tab);
  if (save) { const s=_st(); s.activeTab=tab; _sv(s); }
}
function _scrollTo(id) {
  const el = document.getElementById(id)||document.querySelector(id);
  if (!el) return false;
  let parent = el;
  while (parent && !parent.classList?.contains('tab-panel')) parent = parent.parentElement;
  if (parent) { const tabId = parent.id.replace('tab-',''); switchTab(tabId); }
  setTimeout(() => el.scrollIntoView({behavior:'smooth', block:'center'}), 200);
  el.style.transition = 'box-shadow 0.3s';
  el.style.boxShadow = '0 0 0 3px var(--pink-hot)';
  setTimeout(() => el.style.boxShadow = '', 2000);
  return true;
}
function _kpiValue(keyword, formatted) {
  const cards = document.querySelectorAll('.kpi-card');
  for (const card of cards) {
    const lbl = card.querySelector('.kpi-label');
    if (lbl && lbl.textContent.toLowerCase().includes(keyword.toLowerCase())) {
      const val = card.querySelector('.kpi-value');
      if (val) { val.textContent = formatted; return true; }
    }
  }
  return false;
}

// ══════════════════════════════════════════════════════
//  BRANDING (title / subtitle rename)
// ══════════════════════════════════════════════════════
function _setBranding(field, value) {
  if (field === 'title') {
    const el = document.querySelector('.nav-brand');
    if (el) el.textContent = value;
  } else {
    const el = document.querySelector('.nav-subtitle');
    if (el) el.textContent = value;
  }
  const brand = document.querySelector('.nav-brand')?.textContent || 'Store Analytics Pro';
  const sub   = document.querySelector('.nav-subtitle')?.textContent || '';
  document.title = sub ? `${brand} — ${sub}` : brand;
  const s = _st(); s.branding = s.branding || {}; s.branding[field] = value; _sv(s);
}

// ══════════════════════════════════════════════════════
//  AI-GENERATED CUSTOM CHARTS
// ══════════════════════════════════════════════════════
function _renderCustomChart(def) {
  const grid = document.getElementById('custom-charts-grid');
  if (!grid) return;
  const cardId = 'cc-card-' + def.chart_id;
  if (document.getElementById(cardId)) return; // already rendered

  const card = document.createElement('div');
  card.className = 'chart-card';
  card.id = cardId;
  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div class="section-hdr" id="hdr-${def.chart_id}" style="margin:0;font-size:.82rem">${def.title}</div>
      <button onclick="_removeCustomChart('${def.chart_id}')"
        style="background:none;border:1px solid #ef4444;color:#ef4444;padding:1px 8px;border-radius:4px;cursor:pointer;font-size:.68rem;flex-shrink:0">✕ Remove</button>
    </div>
    <div id="${def.chart_id}" style="height:300px"></div>`;
  grid.appendChild(card);

  const panel = document.getElementById('custom-charts-panel');
  if (panel) panel.style.display = '';

  setTimeout(() => {
    const color = def.color || '#EC4899';
    const multi = ['#EC4899','#1E3A8A','#A855F7','#7DD3FC','#86EFAC','#F9A8D4','#F59E0B','#34D399'];
    let data, layout = patchLayout({
      paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(255,255,255,0.02)',
      font:{family:'Inter',color:'#EAF0FA',size:10},
      margin:{l:60,r:16,t:10,b:80},
      xaxis:{gridcolor:'rgba(249,168,212,0.18)',tickangle:-35},
      yaxis:{gridcolor:'rgba(249,168,212,0.18)'},
    });
    if (def.chart_type === 'pie') {
      data = [{type:'pie',labels:def.x_vals,values:def.y_vals,hole:0.4,
               textinfo:'label+percent',marker:{colors:multi}}];
      delete layout.xaxis; delete layout.yaxis; delete layout.margin;
    } else if (def.chart_type === 'horizontal_bar') {
      data = [{type:'bar',orientation:'h',x:def.y_vals,y:def.x_vals,
               marker:{color:color,opacity:0.85}}];
      layout.margin = {l:180,r:16,t:10,b:40};
      layout.xaxis = {gridcolor:'rgba(249,168,212,0.18)'};
      delete layout.yaxis;
    } else if (def.chart_type === 'line') {
      data = [{type:'scatter',mode:'lines+markers',x:def.x_vals,y:def.y_vals,
               line:{color,width:2},marker:{color}}];
    } else if (def.chart_type === 'scatter') {
      data = [{type:'scatter',mode:'markers',x:def.x_vals,y:def.y_vals,
               marker:{color,size:8,opacity:0.8}}];
    } else {
      data = [{type:'bar',x:def.x_vals,y:def.y_vals,
               marker:{color:multi,opacity:0.9}}];
    }
    Plotly.react(def.chart_id, data, layout, {responsive:true});
    _makeDraggable(card);
  }, 150);

  const s = _st(); s.customCharts = s.customCharts||{}; s.customCharts[def.chart_id] = def; _sv(s);
}

function _removeCustomChart(chartId) {
  document.getElementById('cc-card-' + chartId)?.remove();
  const s = _st();
  if (s.customCharts) { delete s.customCharts[chartId]; _sv(s); }
  const grid = document.getElementById('custom-charts-grid');
  const panel = document.getElementById('custom-charts-panel');
  if (panel && grid && !grid.querySelector('.chart-card')) panel.style.display = 'none';
}

function _clearAllCustomCharts() {
  const grid = document.getElementById('custom-charts-grid');
  if (grid) grid.innerHTML = '';
  const panel = document.getElementById('custom-charts-panel');
  if (panel) panel.style.display = 'none';
  const s = _st(); delete s.customCharts; _sv(s);
}

function _restoreCustomCharts() {
  const s = _st();
  if (!s.customCharts) return;
  Object.values(s.customCharts).forEach(def => _renderCustomChart(def));
}

function _setChartLabel(id, text) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.textContent = text;
  const s = _st(); s.chartLabels = s.chartLabels || {}; s.chartLabels[id] = text; _sv(s);
  return true;
}

// ══════════════════════════════════════════════════════
//  RESTORE SAVED STATE
// ══════════════════════════════════════════════════════
function _applyState() {
  const s = _st();
  if (s.css)  Object.entries(s.css).forEach(([k,v]) => document.documentElement.style.setProperty(k,v));
  if (s.bg)   document.body.style.background = s.bg;
  if (s.kpiPos) _kpiPos(s.kpiPos, false);
  if (s.activeTab) try { switchTab(s.activeTab); } catch(e) {}
  if (s.hidden) s.hidden.forEach(id => _vis(id, false, false));
  if (s.fontSize) document.body.style.fontSize = s.fontSize;
  if (s.deletedCharts) {
    window._deletedCharts = new Set(s.deletedCharts);
  }
  if (s.chartTypes) {
    window._chartTypes = s.chartTypes;
  }
  if (s.branding) {
    if (s.branding.title)    _setBranding('title',    s.branding.title);
    if (s.branding.subtitle) _setBranding('subtitle', s.branding.subtitle);
  }
  if (s.chartLabels) {
    Object.entries(s.chartLabels).forEach(([id, text]) => _setChartLabel(id, text));
  }
  // chartColors are applied in _renderChartWithType after each chart renders
  // Deleted charts: hide cards after DOM ready
  setTimeout(() => {
    window._deletedCharts.forEach(id => {
      const el = document.getElementById(id);
      const card = el?.closest('.chart-card');
      if (card) card.style.display = 'none';
    });
    _updateRestoreButton();
  }, 100);
}
(function(){
  if (document.readyState!=='loading') _applyState();
  else document.addEventListener('DOMContentLoaded', _applyState, {once:true});
})();

// ══════════════════════════════════════════════════════
//  MAIN INSTANT COMMAND ENGINE v3
// ══════════════════════════════════════════════════════
// ── Keyword → _qr key mapping (hidden demo library) ──────
const _K = [
  { k:'store_performance',  w:['total revenue','store performs','which store','revenue store','store better','store comparison','store contributes','store contribute'] },
  { k:'recommendations',    w:['recommendation','increase sales','boost revenue','improve sales','grow revenue','rekomendasi','tingkatkan penjualan','increase revenue'] },
  { k:'patterns',           w:['busiest hour','best day','peak hour','peak day','jam tersibuk','hari tersibuk','busiest time','rental pattern'] },
  { k:'trend',              w:['what caused the revenue drop','revenue drop this month','why did revenue drop','kenapa revenue turun','penyebab revenue turun','compare this month','compare month','previous 3 month','last 3 month','3 bulan terakhir','monthly trend analysis'] },
  { k:'store_analysis',     w:['similar revenue','store 2 more rental','both store','why store','store 1 store 2','store similar','kenapa store'] },
  { k:'compare_months',     w:['compare month','previous 3 month','last 3 month','3 bulan','compare this month sales','previous months'] },
  { k:'categories',         w:['highest revenue category','which categor','top categor','kategori tertinggi','best category','category revenue'] },
  { k:'forecast',           w:['forecast revenue','revenue forecast','next 3 month','next 6 month','predict revenue','show forecast','forecast next','future revenue','prediksi revenue','prediksi penjualan','monthly forecast'] },
  // ── ML / Forecast questions ──────────────────────────
  { k:'__transformer',      w:['transformer outperform','why transformer','why does transformer','transformer better','linear regression outperform','transformer vs linear','kenapa transformer'] },
  { k:'__mae',              w:['what is mae','what does mae','mae mean','mae metric','what is rmse','what is mape','what is r squared','what is r2','explain mae','explain rmse','metric forecast','evaluation metric','mean absolute error'] },
  { k:'__overfitting',      w:['what is overfitting','overfitting mean','why overfit','model overfit','overfit small','kenapa overfit','apa itu overfitting'] },
  { k:'__confidence',       w:['confidence interval','what is confidence','interval forecast','shaded area','band forecast','uncertainty forecast','kenapa ada bayangan','what is the shaded'] },
  { k:'__ensemble',         w:['ensemble forecast','what is ensemble','why ensemble','ensemble model','combined model','average model','why combine'] },
  { k:'__arima',            w:['what is arima','how arima','arima work','arima model','explain arima','kenapa arima','arima vs','arima good'] },
  { k:'__xgboost',          w:['what is xgboost','how xgboost','xgboost work','xgboost model','explain xgboost','gradient boost','xgb model','why xgboost'] },
  { k:'__more_data',        w:['more data','24 month','2 year','if more data','with more data','longer data','data lebih banyak','kalau datanya lebih','improve forecast','improve accuracy'] },
  { k:'__accuracy',         w:['how accurate','forecast accurate','is the forecast','accuracy model','model performance','how good','seberapa akurat','akurasi forecast','mape below','mape above'] },
  { k:'__lstm',             w:['what is lstm','how lstm','lstm work','lstm model','explain lstm','lstm vs transformer','kenapa lstm','long short term'] },
  { k:'__leaderboard',      w:['how is ranking','how rank','leaderboard work','composite score','how composite','ranking model','model ranking','how is model ranked','how is leaderboard'] },
  { k:'__attention',        w:['attention mechanism','self attention','multi head','positional encoding','how transformer work','transformer architecture','transformer deep learning','cara kerja transformer'] },
  { k:'__why_decline',      w:['why revenue decline','why forecast decline','revenue turun','why dropping','revenue decrease forecast','prediksi turun','forecast turun'] },
];

function _checkQr(p) {
  for (const entry of _K) {
    if (entry.w.some(w => p.includes(w))) {
      if (window._qr && window._qr[entry.k]) return window._qr[entry.k];
    }
  }
  return null;
}

function _tryInstantCommand(prompt) {
  const p    = prompt.toLowerCase().trim();
  const ok   = (msg, extra={}) => ({ message: msg, ...extra });

  // ══ DEMO LIBRARY — instant cached answers ══
  // Skip if this looks like a styling/color command — those must not be intercepted
  const _COLOR_NAMES = /\b(red|blue|green|yellow|orange|purple|pink|cyan|navy|gold|teal|lime|rose|indigo|merah|biru|hijau|kuning|ungu|oranye)\b/;
  const _hasColor      = _COLOR_NAMES.test(p) || /#[0-9a-f]{3,6}/i.test(p);
  const _hasVerb       = /\b(change|make|ganti|ubah|jadikan|set|warnai)\b/.test(p);
  const _hasChartAlias = Object.keys(CHART_ALIASES).some(a => a.length > 5 && p.includes(a));
  const _skipQr        = _hasColor && _hasVerb && _hasChartAlias;
  const _qrHit = _skipQr ? null : _checkQr(p);
  if (_qrHit) {
    showToast('📊 Analysed', 'info', 1500);
    return ok(_qrHit);
  }

  // ══ FORECAST — navigate + instant summary ══
  if (/\bforecast|\bprediksi|\bfuture revenue|\bprediction|\bprojection|\bnext \d+ month/.test(p)) {
    _nav('forecast');
    showToast('🔮 Navigated to Forecast', 'success', 2000);
    const cached = window._qr?.forecast;
    if (cached) return ok(cached);
    return ok(
      `🔮 **Navigated to Forecast Tab!**\n\n` +
      `The forecast shows **1–6 month revenue predictions** using 8 models:\n` +
      `- 🏆 **Linear Regression / Ridge** — typically best for 9-month datasets (low overfitting)\n` +
      `- 📊 **XGBoost & ARIMA** — strong performers on short time-series\n` +
      `- 🧠 **Transformer & LSTM** — academic deep learning models (included per requirement)\n\n` +
      `📌 Check the **Model Accuracy Leaderboard** below the chart to see which model has the lowest MAE.\n\n` +
      `💡 **Tip:** Use the **1 / 3 / 6 month** horizon buttons to adjust forecast window.`
    );
  }

  // ══ NAVIGATE TO TAB ══
  const navRe = /\b(go to|navigate|open|buka|pindah ke|switch to|tampilkan|show me)\b/;
  if (navRe.test(p)) {
    for (const [tab, aliases] of Object.entries(TABS)) {
      if (aliases.some(a => p.includes(a))) {
        _nav(tab);
        showToast(`Navigated to ${tab}`, 'success', 2000);
        return ok(`✅ **Navigated to ${tab} tab!**`);
      }
    }
  }

  // ══ SCROLL TO CHART / SECTION ══
  // Guard: skip scroll matching for data/analysis questions
  const _isDataQuery = /\b(loyal|breakdown|show me data|analyze|customer breakdown|by country|by region|by store|how many|what is|what are|berapa|siapa|mana|tunjukkan data|analisis)\b/.test(p);
  const gotoRe = /\b(go to|scroll to|navigate to|focus|sorot|pergi ke|buka)\b/;
  if (!_isDataQuery && gotoRe.test(p)) {
    for (const [alias, chartId] of Object.entries(CHART_ALIASES)) {
      if (p.includes(alias)) {
        const meta = CHARTS[chartId];
        if (meta) {
          _nav(meta.tab);
          setTimeout(() => _scrollTo(chartId), 300);
          showToast(`Scrolled to "${meta.label}"`, 'success', 2000);
          return ok(`✅ **Scrolled to "${meta.label}" chart!**`);
        }
      }
    }
  }

  // ══ KPI POSITION ══
  if (/(kpi|kpi card).*(bottom|bawah)|(move|pindah|geser).*(kpi).*(bottom|bawah|down)/i.test(p)) {
    _kpiPos('bottom');
    showToast('KPI cards moved to bottom', 'success');
    return ok('✅ **KPI cards moved to bottom!**');
  }
  if (/(kpi|kpi card).*(top|atas|kembali|restore)|(move|pindah|geser).*(kpi).*(top|atas|up)/i.test(p)) {
    _kpiPos('top');
    showToast('KPI cards moved to top', 'success');
    return ok('✅ **KPI cards moved to top!**');
  }

  // ══ CHART TYPE CHANGE ══
  const chartTypeRe = /\b(bar|pie|line|scatter|area|donut|doughnut|horizontal bar)\b/g;
  const typeMatches = [...p.matchAll(chartTypeRe)];
  const _isCreateCmd = /\b(?:create|make|add|buat|tambahkan|generate)\b/.test(p);
  if (typeMatches.length > 0 && !_isCreateCmd) {
    const newType = typeMatches[typeMatches.length-1][1];
    let targetId = null, bestLen = 0;
    for (const [alias, chartId] of Object.entries(CHART_ALIASES)) {
      if (p.includes(alias) && alias.length > bestLen) {
        targetId = chartId; bestLen = alias.length;
      }
    }
    if (targetId) {
      const label = CHARTS[targetId]?.label || targetId;
      changeChartTypeUI(targetId, newType);
      showChangeBar(targetId, `Changed ${label} to ${newType} chart`);
      return ok(`✅ **${label} changed to ${newType} chart!**\n\n> Use the **Apply** bar at the bottom to confirm, or **Reject** to revert.`);
    }
  }

  // ══ DELETE CHART ══
  const delRe = /\b(delete|remove|hapus|hilangkan)\b.*\b(chart|grafik)\b/i;
  if (delRe.test(p)) {
    let targetId = null, bestLen = 0;
    for (const [alias, chartId] of Object.entries(CHART_ALIASES)) {
      if (p.includes(alias) && alias.length > bestLen) {
        targetId = chartId; bestLen = alias.length;
      }
    }
    if (targetId) {
      deleteChart(targetId);
      return ok(`✅ **${CHARTS[targetId]?.label || targetId} deleted!** You can restore it with "restore [chart name]" or via the restore button.`);
    }
  }

  // ══ RESTORE CHART ══
  const restoreRe = /\b(restore|kembalikan|munculkan kembali)\b/i;
  if (restoreRe.test(p)) {
    if (p.includes('all') || p.includes('semua')) {
      restoreAllCharts();
      return ok('✅ **All charts restored!**');
    }
    for (const [alias, chartId] of Object.entries(CHART_ALIASES)) {
      if (p.includes(alias)) {
        restoreChart(chartId);
        return ok(`✅ **${CHARTS[chartId]?.label || chartId} restored!**`);
      }
    }
  }

  // ══ CHART-SPECIFIC COLOR CHANGE — must run before background/accent blocks ══
  const _namedColors = {
    red:'#ef4444', blue:'#3b82f6', green:'#22c55e', yellow:'#eab308',
    orange:'#f97316', purple:'#a855f7', pink:'#ec4899', cyan:'#06b6d4',
    white:'#f8fafc', gray:'#6b7280', grey:'#6b7280', navy:'#1e3a8a',
    gold:'#f59e0b', teal:'#14b8a6', lime:'#84cc16', indigo:'#6366f1', rose:'#f43f5e',
    biru:'#3b82f6', merah:'#ef4444', hijau:'#22c55e', kuning:'#eab308',
    ungu:'#a855f7', oranye:'#f97316', putih:'#f8fafc', abu:'#6b7280',
  };
  const _hexInPrompt  = prompt.match(/#([0-9a-fA-F]{3,6})\b/);
  const _nameInPrompt = prompt.match(/\b(red|blue|green|yellow|orange|purple|pink|cyan|white|gray|grey|navy|gold|teal|lime|indigo|rose|biru|merah|hijau|kuning|ungu|oranye|putih|abu)\b/i);
  const _detectedColor = _hexInPrompt ? _hexInPrompt[0] : (_nameInPrompt ? _namedColors[_nameInPrompt[1].toLowerCase()] : null);
  const _isColorIntent = /\b(?:color|warna|colored|colou?r)\b/i.test(p)
    || /\b(?:ganti warna|ubah warna|change.*color|warnai)\b/i.test(p)
    || (_detectedColor !== null && /\b(?:change|make|ganti|ubah|jadikan|set)\b/i.test(p));

  if (_detectedColor && _isColorIntent) {
    // Only intercept if a known chart alias is mentioned — otherwise fall through to bg/accent
    let _chartColorId = null, _chartColorBest = 0;
    for (const [alias, chartId] of Object.entries(CHART_ALIASES)) {
      if (p.includes(alias) && alias.length > _chartColorBest) {
        _chartColorId = chartId; _chartColorBest = alias.length;
      }
    }
    if (_chartColorId) {
      const _lbl = CHARTS[_chartColorId]?.label || _chartColorId;
      const _chartTab = CHARTS[_chartColorId]?.tab;
      // 1. Save to localStorage — render hook uses this on every future render
      const s = _st(); s.chartColors = s.chartColors||{}; s.chartColors[_chartColorId] = _detectedColor; _sv(s);
      // 2. Navigate to chart's tab if needed
      const _activeTab = document.querySelector('.tab-panel.active')?.id?.replace('tab-','');
      if (_chartTab && _activeTab !== _chartTab) _nav(_chartTab);
      // 3. Re-render from cache — _renderChartWithType will now inject the saved color
      const delay = (_chartTab && _activeTab !== _chartTab) ? 350 : 0;
      setTimeout(() => {
        const cache = window._chartDataCache[_chartColorId];
        if (cache?.rawData) {
          _renderChartWithType(_chartColorId, cache.rawData, cache.rawLayout, cache.apiData);
        }
      }, delay);
      showToast(`${_lbl} → ${_detectedColor}`, 'success');
      return ok(`✅ **${_lbl}** color changed to \`${_detectedColor}\`!\n\n> Saved permanently.`);
    }
  }

  // ══ THEME PRESETS — skip if a chart alias is in prompt (that's a chart color, not theme) ══
  // Theme presets — skip only if there's also a detected color + chart alias (handled by color block above)
  if (!(_detectedColor && _isColorIntent)) {
    const themeRe = /\b(theme|tema|mode|ganti tema|dark|light)\b/;
    const _wMatch = (w) => new RegExp(`\\b${w}\\b`).test(p);
    for (const [name, cfg] of Object.entries(THEMES)) {
      if (name === 'default') continue;
      const words = name.split(' ');
      if (words.every(_wMatch) || (themeRe.test(p) && words.some(w => w.length > 3 && _wMatch(w)))) {
        _theme(cfg);
        showToast(`${name} theme applied!`, 'success');
        return ok(`✅ **${name.charAt(0).toUpperCase()+name.slice(1)} theme applied!**`);
      }
    }
  }

  // ══ BACKGROUND COLOR ══
  if (/\b(background|bg|latar|warna latar)\b/.test(p)) {
    const hexM = p.match(/#([0-9a-f]{3,6})\b/);
    if (hexM) {
      _bg(`linear-gradient(135deg,${hexM[0]} 0%,${hexM[0]} 100%)`);
      _css('--bg', hexM[0]); _css('--bg2', hexM[0]);
      showToast(`Background changed to ${hexM[0]}`, 'success');
      return ok(`✅ **Background changed to ${hexM[0]}!**`);
    }
    for (const [name, cfg] of Object.entries(THEMES)) {
      if (name.split(' ').some(w => w.length > 3 && new RegExp(`\\b${w}\\b`).test(p))) {
        _theme(cfg); showToast(`Background: ${name}`, 'success');
        return ok(`✅ **Background changed to ${name}!**`);
      }
    }
  }

  // ══ ACCENT / PRIMARY COLOR ══
  if (/\b(accent|warna utama|primary color|main color|warna aksen|highlight|color|warna)\b/.test(p)) {
    for (const [word, cfg] of Object.entries(ACCENTS)) {
      if (p.includes(word)) {
        _css('--pink-hot', cfg.v); _css('--accent', cfg.v); _css('--pink', cfg.s);
        showToast(`Accent → ${word}`, 'success');
        return ok(`✅ **Accent color changed to ${word}!**`);
      }
    }
    const hexM = p.match(/#([0-9a-f]{3,6})\b/);
    if (hexM) {
      _css('--pink-hot',hexM[0]); _css('--accent',hexM[0]); _css('--pink',hexM[0]);
      showToast(`Accent → ${hexM[0]}`, 'success');
      return ok(`✅ **Accent color changed to ${hexM[0]}!**`);
    }
  }

  // ══ DARK / LIGHT MODE ══
  if (/\b(dark mode|light mode|mode gelap|mode terang|switch mode|toggle mode|dark theme|light theme)\b/.test(p)) {
    if (/light|terang/.test(p)) { isLight=true;  applyTheme(); refreshAll(); showToast('Light mode!', 'info'); return ok('✅ **Switched to Light mode!**'); }
    if (/dark|gelap/.test(p))  { isLight=false; applyTheme(); refreshAll(); showToast('Dark mode!', 'info'); return ok('✅ **Switched to Dark mode!**'); }
    toggleTheme(); return ok('✅ **Theme toggled!**');
  }

  // ══ FONT SIZE ══
  const fontRe = /\b(font size|ukuran huruf|font besar|font kecil|text size|bigger font|smaller font)\b/;
  if (fontRe.test(p)) {
    const sizeM = p.match(/(\d+)\s*px/);
    if (sizeM) {
      document.body.style.fontSize = sizeM[1]+'px';
      const s=_st(); s.fontSize=sizeM[1]+'px'; _sv(s);
      showToast(`Font size → ${sizeM[1]}px`, 'success');
      return ok(`✅ **Font size set to ${sizeM[1]}px!**`);
    }
    if (/bigger|larger|besar/.test(p)) { document.body.style.fontSize='16px'; return ok('✅ **Font size increased!**'); }
    if (/smaller|kecil/.test(p))       { document.body.style.fontSize='12px'; return ok('✅ **Font size decreased!**'); }
  }

  // ══ KPI SIZE ══
  if (/kpi.*(bigger|larger|besar|gedein)|(bigger|larger|besar|gedein).*kpi/.test(p)) {
    document.querySelectorAll('.kpi-card').forEach(el=>{el.style.padding='28px 32px';el.style.minWidth='210px';});
    showToast('KPI cards enlarged!', 'success');
    return ok('✅ **KPI cards enlarged!**');
  }
  if (/kpi.*(smaller|kecil|kecilin)|(smaller|kecil|kecilin).*kpi/.test(p)) {
    document.querySelectorAll('.kpi-card').forEach(el=>{el.style.padding='12px 14px';el.style.minWidth='130px';});
    return ok('✅ **KPI cards made smaller!**');
  }

  // ══ KPI VALUE OVERRIDE ══
  const kpiRe = /(?:set|ubah|ganti|change|update|jadikan)\s+(revenue|rental|customer|avg|transaction|total)\s+(?:to|jadi|ke|menjadi|=)\s*\$?([\d,.]+\s*(?:m|million|juta|b|billion|k|thousand|rb|ribu)?)/i;
  const kpiM = p.match(kpiRe);
  if (kpiM) {
    let raw = kpiM[2].trim().toLowerCase();
    let num = parseFloat(raw.replace(/,/g,''));
    if (/b|billion/i.test(raw)) num *= 1e9;
    else if (/m|million|juta/i.test(raw)) num *= 1e6;
    else if (/k|thousand|rb|ribu/i.test(raw)) num *= 1e3;
    const kw = kpiM[1].toLowerCase();
    const fmt = (kw==='avg'||kw==='transaction') ? '$'+num.toFixed(2) : (kw==='revenue'?'$'+num.toLocaleString('en',{minimumFractionDigits:2}):num.toLocaleString());
    const done = _kpiValue(kw, fmt);
    return ok(done ? `✅ **${kw} KPI updated to ${fmt}!** (Visual only — DB unchanged)` : `⚠️ KPI card "${kw}" not found.`);
  }

  // ══ HIDE / SHOW SECTIONS ══
  const hideRe = /\b(hide|sembunyikan|hapus|hilangkan)\b/;
  const showRe = /\b(show|tampilkan|unhide|munculkan|lihat)\b/;
  const sections = [
    [/\bkpi\b/,               'kpi-row'],
    [/filter\s*bar/,          '.filter-bar'],
    [/nav.*bar|navbar|header/, '.nav-bar'],
    [/insight\s*box|overview\s*insight/, 'overview-insight'],
  ];
  for (const [pat, sel] of sections) {
    if (pat.test(p)) {
      if (hideRe.test(p)) { _vis(sel,false); showToast(`${sel} hidden`, 'info'); return ok(`✅ **${sel} hidden!**`); }
      if (showRe.test(p)) { _vis(sel,true);  showToast(`${sel} shown`, 'info');  return ok(`✅ **${sel} shown!**`); }
    }
  }

  // ══ RESET ══
  if (/\b(reset|kembalikan.*awal|restore.*default|clear.*all.*change|hapus.*semua.*perubahan)\b/.test(p)) {
    setTimeout(() => { localStorage.removeItem(_SK); location.reload(); }, 400);
    showToast('Resetting to defaults...', 'info');
    return ok('♻️ **Resetting to defaults...** Reloading in 0.4s.');
  }

  // ══ SAVE LAYOUT / LOCK LAYOUT ══
  if (/\b(save layout|simpan layout|lock layout|kunci layout|save.*position|save.*order)\b/.test(p)) {
    document.querySelectorAll('.chart-grid, .chart-grid-3, #tab-overview, #tab-inventory, #tab-customers, #tab-patterns').forEach(container => {
      if (container.id) _saveCardOrder(container);
    });
    return ok('✅ **Layout saved!** Card order will be restored on refresh.');
  }

  // ══ SWAP CARDS (e.g. "swap store revenue with store rentals") ══
  const swapM = p.match(/swap\s+(.+?)\s+(?:with|dan|dan)\s+(.+)/i);
  if (swapM) {
    let id1 = null, id2 = null, best1 = 0, best2 = 0;
    for (const [alias, chartId] of Object.entries(CHART_ALIASES)) {
      const a1 = swapM[1].toLowerCase(), a2 = swapM[2].toLowerCase();
      if (a1.includes(alias) && alias.length > best1) { id1 = chartId; best1 = alias.length; }
      if (a2.includes(alias) && alias.length > best2) { id2 = chartId; best2 = alias.length; }
    }
    if (id1 && id2) {
      const el1 = document.getElementById(id1)?.closest('.chart-card');
      const el2 = document.getElementById(id2)?.closest('.chart-card');
      if (el1 && el2 && el1.parentNode === el2.parentNode) {
        const parent = el1.parentNode;
        const next1 = el1.nextSibling;
        parent.insertBefore(el1, el2);
        parent.insertBefore(el2, next1);
        _saveCardOrder(parent);
        return ok(`✅ **Swapped "${CHARTS[id1]?.label}" and "${CHARTS[id2]?.label}"!** Layout saved permanently.`);
      }
    }
    return ok(`⚠️ Could not find both charts to swap. Try being more specific, e.g. "swap store revenue with store rentals"`);
  }

  // (chart color change handled earlier, before theme/background blocks)

  // ══ MOVE CHART (left / right / after / before) ══
  if (/\b(?:move|pindah(?:kan)?|geser|taruh)\b/i.test(p)) {
    // Determine direction or relative position
    const isRight   = /\b(?:right|kanan)\b/i.test(p);
    const isLeft    = /\b(?:left|kiri)\b/i.test(p);
    const afterRefM = p.match(/\b(?:after|setelah)\b\s+(.+)/i);
    const beforeRefM= p.match(/\b(?:before|sebelum)\b\s+(.+)/i);

    // Extract source chart name: strip move keyword + direction/relation tail
    let srcText = p
      .replace(/\b(?:move|pindah(?:kan)?|geser|taruh)\b\s*/i, '')  // remove verb
      .replace(/\bto\b.*/i, '')          // remove "to right side" etc
      .replace(/\b(?:right|left|kanan|kiri)\b.*/i, '')
      .replace(/\b(?:after|setelah|before|sebelum)\b.*/i, '')
      .replace(/\bchart\b/gi, '')        // remove "chart" word
      .trim();

    let srcId = null, bestSrc = 0;
    for (const [alias, chartId] of Object.entries(CHART_ALIASES)) {
      if (srcText.includes(alias) && alias.length > bestSrc) { srcId = chartId; bestSrc = alias.length; }
    }
    // Fallback: search full prompt for alias if strip was too aggressive
    if (!srcId) {
      for (const [alias, chartId] of Object.entries(CHART_ALIASES)) {
        if (p.includes(alias) && alias.length > bestSrc) { srcId = chartId; bestSrc = alias.length; }
      }
    }

    if (srcId) {
      const srcCard = document.getElementById(srcId)?.closest('.chart-card');
      const label   = CHARTS[srcId]?.label || srcId;
      if (srcCard) {
        if (isRight) {
          const next = srcCard.nextElementSibling;
          if (next?.classList.contains('chart-card')) {
            srcCard.parentNode.insertBefore(next, srcCard);
            _saveCardOrder(srcCard.parentNode);
            showToast('Chart moved right!', 'success');
            return ok(`✅ **${label}** moved right and saved permanently.`);
          }
          return ok(`⚠️ **${label}** is already the rightmost chart in its row.`);
        }
        if (isLeft) {
          const prev = srcCard.previousElementSibling;
          if (prev?.classList.contains('chart-card')) {
            srcCard.parentNode.insertBefore(srcCard, prev);
            _saveCardOrder(srcCard.parentNode);
            showToast('Chart moved left!', 'success');
            return ok(`✅ **${label}** moved left and saved permanently.`);
          }
          return ok(`⚠️ **${label}** is already the leftmost chart in its row.`);
        }
        if (afterRefM || beforeRefM) {
          const refText = (afterRefM?.[1] || beforeRefM?.[1] || '').replace(/\bchart\b/gi,'').trim();
          let refId = null, bestRef = 0;
          for (const [alias, chartId] of Object.entries(CHART_ALIASES)) {
            if (refText.includes(alias) && alias.length > bestRef) { refId = chartId; bestRef = alias.length; }
          }
          if (refId) {
            const refCard = document.getElementById(refId)?.closest('.chart-card');
            if (refCard && refCard.parentNode === srcCard.parentNode) {
              if (afterRefM) refCard.parentNode.insertBefore(srcCard, refCard.nextSibling);
              else           refCard.parentNode.insertBefore(srcCard, refCard);
              _saveCardOrder(srcCard.parentNode);
              const rel = afterRefM ? 'after' : 'before';
              showToast('Chart moved!', 'success');
              return ok(`✅ **${label}** moved ${rel} **${CHARTS[refId]?.label}** and saved permanently.`);
            }
            return ok(`⚠️ Both charts must be in the same grid row to reorder. Try "swap ${label} with ${CHARTS[refId]?.label}" instead.`);
          }
        }
      }
    }
    // If we matched "move" but couldn't identify chart/direction, give a helpful error
    if (/\b(?:right|left|kanan|kiri|after|setelah|before|sebelum)\b/i.test(p)) {
      return ok(`⚠️ Couldn't identify the chart to move. Try: **"move [chart name] right"** or **"move [chart name] after [other chart]"**.\n\nKnown charts: store revenue, store rentals, revenue trend, customer distribution, global revenue, hourly rental, etc.`);
    }
  }

  // ══ RENAME SECTION HEADER / CHART TITLE ══
  const hdrRenameM = prompt.match(/\b(?:rename|change|ganti|ubah)\b\s+(?:the\s+)?(?:chart\s+|section\s+|header\s+|label\s+)?["""]?(.+?)["""]?\s+(?:to|jadi|ke|menjadi)\s+["""]?(.+?)["""]?\s*$/i);
  if (hdrRenameM) {
    const srcRaw = hdrRenameM[1].trim();
    const newText = hdrRenameM[2].trim();
    const srcLow = srcRaw.toLowerCase();
    // Skip if looks like a brand/title command (handled below)
    const isBrandCmd = /\b(title|judul|brand|subtitle|tagline|keterangan|app|aplikasi|nama app)\b/.test(srcLow);
    if (!isBrandCmd) {
      let bestEl = null, bestScore = 0;
      document.querySelectorAll('.section-hdr[id]').forEach(el => {
        const cur = el.textContent.toLowerCase();
        const words = srcLow.split(/\s+/).filter(w => w.length > 2);
        const score = words.filter(w => cur.includes(w)).length;
        if (score > bestScore) { bestScore = score; bestEl = el; }
      });
      if (bestEl && bestScore > 0) {
        const oldText = bestEl.textContent.trim();
        _setChartLabel(bestEl.id, newText);
        showToast('Chart header updated!', 'success');
        return ok(`✅ **"${oldText}" → "${newText}"**\n\n> Saved permanently.`);
      }
    }
  }

  // ══ RENAME TITLE / SUBTITLE ══
  const brandM = prompt.match(/\b(?:rename|change|ganti|ubah|set)\b.+?\b(title|judul|brand|nama|app|aplikasi|subtitle|tagline|keterangan)\b.+?\b(?:to|jadi|ke|menjadi)\b\s*(.+)/i);
  if (brandM) {
    const isSubtitle = /subtitle|tagline|keterangan/.test(brandM[1].toLowerCase());
    const newVal = brandM[2].trim();
    _setBranding(isSubtitle ? 'subtitle' : 'title', newVal);
    const label = isSubtitle ? 'Subtitle' : 'Title';
    showToast(`${label} updated!`, 'success');
    return ok(`✅ **${label} changed to "${newVal}"!**\n\n> Saved permanently — persists after refresh.`);
  }

  // ══ SHOW CODE ══
  if (/\b(show code|lihat code|kode|tampilkan code|view code)\b/.test(p)) {
    let targetId = null, bestLen = 0;
    for (const [alias, chartId] of Object.entries(CHART_ALIASES)) {
      if (p.includes(alias) && alias.length > bestLen) { targetId = chartId; bestLen = alias.length; }
    }
    if (targetId) {
      const cache = window._chartDataCache[targetId];
      if (cache?.rawData) {
        const code = `// Chart data for ${CHARTS[targetId]?.label || targetId}\nPlotly.react('${targetId}', ${JSON.stringify(cache.rawData, null, 2).substring(0, 800)}...\n// Use changeChartTypeUI('${targetId}', 'pie') to change type`;
        return ok(`\`\`\`javascript\n${code}\n\`\`\``);
      }
    }
    return null; // Let AI handle
  }

  return null;
}

// ══════════════════════════════════════════════════════
//  DIRECT SQL BUILDER — natural language → SQL (no LLM)
// ══════════════════════════════════════════════════════
const _COUNTRIES = ['india','china','united states','usa','brazil','mexico','indonesia','philippines',
  'nigeria','russia','japan','germany','france','united kingdom','uk','canada','australia',
  'argentina','egypt','turkey','iran','colombia','ukraine','saudi arabia','malaysia','peru',
  'venezuela','thailand','south africa','taiwan','italy','spain','poland','south korea'];

function _buildDirectSQL(raw) {
  const p = raw.toLowerCase();
  if (!/\b(?:show|list|find|get|tampilkan|cari|display)\b/.test(p)) return null;

  // helper — parse "more than 100k" → number
  function _parseNum(str) {
    if (!str) return null;
    let v = parseFloat(str.replace(/,/g,''));
    if (/k$/i.test(str)) v *= 1000;
    else if (/m$|juta$/i.test(str)) v *= 1000000;
    else if (/ribu$/i.test(str)) v *= 1000;
    return isNaN(v) ? null : v;
  }
  function _amtFilter(pat) {
    const m = p.match(pat);
    return m ? _parseNum(m[1] + (m[2]||'')) : null;
  }

  // ── 1. ACTOR (before film — "30 films" in actor queries must not trigger film branch) ──
  if (/\bactor|\bactress|\baktris|\bpemain|\bbintang/.test(p)) {
    const filmM = p.match(/(?:more|greater|over)\s+than\s+([\d,]+)\s+film/i);
    const minFilms = filmM ? parseInt(filmM[1].replace(/,/g,'')) : null;
    const rentM = p.match(/(?:rental|disewa).*(?:more|greater|over)\s+than\s+([\d,]+)/i);
    const minRent = rentM ? parseInt(rentM[1].replace(/,/g,'')) : null;
    const sortByFilms = /sort.*film|film.*sort|by film|most film/.test(p);

    const having = [];
    if (minFilms) having.push(`COUNT(DISTINCT fa.film_id) > ${minFilms}`);
    if (minRent)  having.push(`COUNT(r.rental_id) > ${minRent}`);
    const havingClause = having.length ? `HAVING ${having.join(' AND ')}` : '';
    const orderBy = sortByFilms ? 'films DESC' : 'total_rentals DESC';

    const sql = `
      SELECT a.first_name||' '||a.last_name AS actor,
             COUNT(DISTINCT fa.film_id) AS films,
             COUNT(r.rental_id) AS total_rentals,
             ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
      FROM actor a
      JOIN film_actor fa ON a.actor_id=fa.actor_id
      JOIN inventory i ON fa.film_id=i.film_id
      LEFT JOIN rental r ON i.inventory_id=r.inventory_id
      LEFT JOIN payment p ON r.rental_id=p.rental_id
      GROUP BY a.actor_id, a.first_name, a.last_name
      ${havingClause}
      ORDER BY ${orderBy}
      LIMIT 25`;
    const parts = [];
    if (minFilms) parts.push(`films > **${minFilms}**`);
    if (minRent)  parts.push(`rentals > **${minRent}**`);
    return { sql, label:`Actors ${parts.length?'('+parts.join(', ')+')':'by rentals'}` };
  }

  // ── 2. CUSTOMER ────────────────────────────────────
  if (/\bcustomer|\bpelanggan|\bclient/.test(p)) {
    let country = null;
    for (const c of _COUNTRIES) { if (p.includes(c)) { country = c; break; } }
    const countryTitle = country ? country.replace(/\b\w/g,l=>l.toUpperCase()) : null;

    const minAmt = _amtFilter(/(?:more|greater|over|above|lebih)\s+than\s*\$?([\d,]+(?:\.\d+)?)\s*(k|m|juta|ribu)?/i)
                || _amtFilter(/(?:spend|spent|cost|bayar)\s*(?:more|>)\s*\$?([\d,]+(?:\.\d+)?)\s*(k|m|juta|ribu)?/i);
    const maxAmt = /less|kurang|below|under/.test(p)
      ? _amtFilter(/(?:less|kurang|below|under)\s+than\s*\$?([\d,]+(?:\.\d+)?)\s*(k|m|juta|ribu)?/i) : null;
    const rentM = p.match(/rent(?:al)?s?\s+(?:more|greater|over)\s+than\s+([\d,]+)/i);
    const minRentals = rentM ? parseInt(rentM[1].replace(/,/g,'')) : null;
    const sortByRentals = /sort.*rental|rental.*sort|by rental|most rental/.test(p);

    const having = ['1=1'];
    if (countryTitle) having.push(`LOWER(co.country) = '${country}'`);
    if (minAmt)  having.push(`ROUND(SUM(p.amount)::numeric,2) > ${minAmt}`);
    if (maxAmt)  having.push(`ROUND(SUM(p.amount)::numeric,2) < ${maxAmt}`);
    if (minRentals) having.push(`COUNT(r.rental_id) > ${minRentals}`);

    const sql = `
      SELECT c.first_name||' '||c.last_name AS customer,
             co.country,
             COUNT(r.rental_id) AS total_rentals,
             ROUND(SUM(p.amount)::numeric,2) AS total_spent
      FROM customer c
      JOIN address a ON c.address_id=a.address_id
      JOIN city ci ON a.city_id=ci.city_id
      JOIN country co ON ci.country_id=co.country_id
      JOIN rental r ON c.customer_id=r.customer_id
      LEFT JOIN payment p ON r.rental_id=p.rental_id
      GROUP BY c.customer_id, c.first_name, c.last_name, co.country
      HAVING ${having.join(' AND ')}
      ORDER BY ${sortByRentals?'total_rentals':'total_spent'} DESC
      LIMIT 30`;
    const parts = [];
    if (countryTitle) parts.push(`in **${countryTitle}**`);
    if (minAmt)  parts.push(`spent > **$${minAmt.toLocaleString()}**`);
    if (maxAmt)  parts.push(`spent < **$${maxAmt.toLocaleString()}**`);
    if (minRentals) parts.push(`rentals > **${minRentals}**`);
    return { sql, label:`Customers ${parts.join(', ')||''} sorted by ${sortByRentals?'rentals':'total spent'}` };
  }

  // ── 3. FILM / MOVIE ────────────────────────────────
  if (/\bfilm|\bmovie|\btitle|\bjudul/.test(p)) {
    const _CATS = ['action','animation','children','classics','comedy','documentary',
                   'drama','family','foreign','games','horror','music','new','sci-fi','sports','travel'];
    const _RATINGS = ['nc-17','pg-13','pg','g','r'];  // longer first to avoid partial match
    let catFilter = null, ratingFilter = null;
    for (const c of _CATS) { if (p.includes(c)) { catFilter = c; break; } }
    for (const r of _RATINGS) { if (p.includes(r)) { ratingFilter = r.toUpperCase(); break; } }

    const minRate = _amtFilter(/rental\s+rate\s+(?:more|greater|over|>)\s*than\s*\$?([\d.]+)\s*()/i)
                 || _amtFilter(/rate\s*>\s*\$?([\d.]+)\s*()/i);
    const minRentals = _amtFilter(/(?:more|greater|over)\s+than\s+([\d,]+)\s*(?:time|rental)/i)
                    || _amtFilter(/(?:rented|disewa)\s+(?:more|greater|over)\s+than\s+([\d,]+)\s*()/i);
    const maxRentals = _amtFilter(/(?:less|fewer|under|below)\s+than\s+([\d,]+)\s*(?:time|rental)/i);
    const isOverstock = /overstock|over.?stock|too many cop|banyak copy/.test(p);
    const isSlow      = /\bslow|\bunderperform|\bsedikit disewa|\bjarang/.test(p);

    let where = [], having = [];
    const joinCat = catFilter
      ? `JOIN film_category fc ON f.film_id=fc.film_id JOIN category c ON fc.category_id=c.category_id`
      : `LEFT JOIN film_category fc ON f.film_id=fc.film_id LEFT JOIN category c ON fc.category_id=c.category_id`;
    if (catFilter)    where.push(`LOWER(c.name) = '${catFilter}'`);
    if (ratingFilter) where.push(`f.rating = '${ratingFilter}'`);
    if (minRate)      where.push(`f.rental_rate > ${minRate}`);
    if (isOverstock)  having.push(`COUNT(DISTINCT i.inventory_id) >= 4 AND COUNT(r.rental_id) < 5`);
    if (isSlow)       having.push(`COUNT(r.rental_id) < 5`);
    if (minRentals)   having.push(`COUNT(r.rental_id) > ${minRentals}`);
    if (maxRentals)   having.push(`COUNT(r.rental_id) < ${maxRentals}`);

    const sql = `
      SELECT f.title, c.name AS category, f.rating, f.rental_rate,
             COUNT(DISTINCT i.inventory_id) AS copies,
             COUNT(r.rental_id) AS total_rentals,
             ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
      FROM film f
      ${joinCat}
      JOIN inventory i ON f.film_id=i.film_id
      LEFT JOIN rental r ON i.inventory_id=r.inventory_id
      LEFT JOIN payment p ON r.rental_id=p.rental_id
      ${where.length?'WHERE '+where.join(' AND '):''}
      GROUP BY f.film_id, f.title, c.name, f.rating, f.rental_rate
      ${having.length?'HAVING '+having.join(' AND '):''}
      ORDER BY total_rentals ${/least|lowest|fewest|sedikit/.test(p)?'ASC':'DESC'}
      LIMIT 25`;
    const parts = [];
    if (catFilter)    parts.push(`category: **${catFilter}**`);
    if (ratingFilter) parts.push(`rating: **${ratingFilter}**`);
    if (minRate)      parts.push(`rate > **$${minRate}**`);
    if (minRentals)   parts.push(`rentals > **${minRentals}**`);
    if (maxRentals)   parts.push(`rentals < **${maxRentals}**`);
    if (isOverstock)  parts.push(`overstock`);
    if (isSlow)       parts.push(`slow-moving`);
    return { sql, label:`Films ${parts.length?'('+parts.join(', ')+')':'by rentals'}` };
  }

  // ── 4. COUNTRY / GEO ───────────────────────────────
  if (/\bcountr|\bnegara|\bgeo|\bregion|\bcity|\bkota/.test(p)) {
    const minRev  = _amtFilter(/(?:revenue|income|pendapatan)\s+(?:more|greater|over)\s+than\s*\$?([\d,]+(?:\.\d+)?)\s*(k|m|juta)?/i);
    const minCust = (() => { const m=p.match(/customer\w*\s+(?:more|greater|over)\s+than\s+([\d,]+)/i); return m?parseInt(m[1].replace(/,/g,'')):null; })();
    const having = ['1=1'];
    if (minRev)  having.push(`ROUND(SUM(p.amount)::numeric,2) > ${minRev}`);
    if (minCust) having.push(`COUNT(DISTINCT c.customer_id) > ${minCust}`);
    const sql = `
      SELECT co.country,
             COUNT(DISTINCT c.customer_id) AS customers,
             COUNT(r.rental_id) AS rentals,
             ROUND(SUM(p.amount)::numeric,2) AS revenue
      FROM country co
      JOIN city ci ON co.country_id=ci.country_id
      JOIN address a ON ci.city_id=a.city_id
      JOIN customer c ON a.address_id=c.address_id
      JOIN rental r ON c.customer_id=r.customer_id
      LEFT JOIN payment p ON r.rental_id=p.rental_id
      GROUP BY co.country
      HAVING ${having.join(' AND ')}
      ORDER BY revenue DESC LIMIT 25`;
    const parts = [];
    if (minRev)  parts.push(`revenue > **$${minRev.toLocaleString()}**`);
    if (minCust) parts.push(`customers > **${minCust}**`);
    return { sql, label:`Countries ${parts.length?'('+parts.join(', ')+')':'by revenue'}` };
  }

  // ── 5. CATEGORY ────────────────────────────────────
  if (/\bcategor|\bgenre|\bkategori/.test(p)) {
    const minRev = _amtFilter(/(?:revenue|income)\s+(?:more|greater|over)\s+than\s*\$?([\d,]+(?:\.\d+)?)\s*(k|m|juta)?/i);
    const sql = `
      SELECT c.name AS category,
             COUNT(DISTINCT f.film_id) AS films,
             COUNT(r.rental_id) AS rentals,
             ROUND(SUM(p.amount)::numeric,2) AS revenue,
             ROUND(AVG(f.rental_rate)::numeric,2) AS avg_rate
      FROM category c
      JOIN film_category fc ON c.category_id=fc.category_id
      JOIN film f ON fc.film_id=f.film_id
      JOIN inventory i ON f.film_id=i.film_id
      LEFT JOIN rental r ON i.inventory_id=r.inventory_id
      LEFT JOIN payment p ON r.rental_id=p.rental_id
      GROUP BY c.name
      ${minRev?`HAVING ROUND(SUM(p.amount)::numeric,2) > ${minRev}`:''}
      ORDER BY revenue DESC`;
    return { sql, label:`Categories${minRev?' (revenue > $'+minRev.toLocaleString()+')':''}` };
  }

  return null;
}

// ══════════════════════════════════════════════════════
//  DIRECT CHART CREATOR — no LLM needed
// ══════════════════════════════════════════════════════
async function _tryCreateChart(raw) {
  const p = raw.toLowerCase().trim();

  // Must be a create/make/add chart command
  if (!/\b(?:create|make|add|buat|tambahkan|generate)\b/.test(p)) return null;
  if (!/\b(?:chart|graph|grafik|visualization|visualisasi)\b/.test(p)) return null;

  // Chart type
  let chartType = 'bar';
  if (/horizontal.?bar|hbar/.test(p))          chartType = 'horizontal_bar';
  else if (/\bpie|\bdonut|\bdoughnut/.test(p))  chartType = 'pie';
  else if (/\bline|\btrend/.test(p))            chartType = 'line';
  else if (/\bscatter/.test(p))                 chartType = 'scatter';

  // Limit
  const limM = p.match(/top\s+(\d+)/i);
  const lim  = limM ? parseInt(limM[1]) : 15;
  const sortDir = /least|lowest|fewest|bottom|asc/.test(p) ? 'ASC' : 'DESC';
  const byRev = /revenue|income|pendapatan/.test(p);

  let sql = null, title = '', x_col = '', y_col = '';

  if (/\brating/.test(p)) {
    x_col='rating'; y_col=byRev?'revenue':'rentals';
    title='Films by Rating';
    sql=`SELECT f.rating, COUNT(DISTINCT f.film_id) AS films,
               COUNT(r.rental_id) AS rentals,
               ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
         FROM film f JOIN inventory i ON f.film_id=i.film_id
         LEFT JOIN rental r ON i.inventory_id=r.inventory_id
         LEFT JOIN payment p ON r.rental_id=p.rental_id
         GROUP BY f.rating ORDER BY rentals DESC`;
  } else if (/\bfilm|\bmovie|\btitle|\bjudul/.test(p)) {
    x_col='title'; y_col=byRev?'revenue':'rentals';
    title=`Top ${lim} Film Titles by ${byRev?'Revenue':'Rentals'}`;
    sql=`SELECT f.title, COUNT(r.rental_id) AS rentals,
               ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
         FROM film f JOIN inventory i ON f.film_id=i.film_id
         LEFT JOIN rental r ON i.inventory_id=r.inventory_id
         LEFT JOIN payment p ON r.rental_id=p.rental_id
         GROUP BY f.film_id,f.title ORDER BY ${y_col} ${sortDir} LIMIT ${lim}`;
  } else if (/\bcustomer|\bpelanggan/.test(p)) {
    const byRent=/rental/.test(p);
    x_col='customer'; y_col=byRent?'total_rentals':'total_spent';
    title=`Top ${lim} Customers by ${byRent?'Rentals':'Revenue'}`;
    chartType=chartType==='bar'?'horizontal_bar':chartType;
    sql=`SELECT c.first_name||' '||c.last_name AS customer,
               COUNT(r.rental_id) AS total_rentals,
               ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS total_spent
         FROM customer c JOIN rental r ON c.customer_id=r.customer_id
         LEFT JOIN payment p ON r.rental_id=p.rental_id
         GROUP BY c.customer_id,c.first_name,c.last_name
         ORDER BY ${y_col} ${sortDir} LIMIT ${lim}`;
  } else if (/\bcategor|\bgenre/.test(p)) {
    x_col='category'; y_col=byRev?'revenue':'rentals';
    title=`Categories by ${byRev?'Revenue':'Rentals'}`;
    sql=`SELECT c.name AS category, COUNT(r.rental_id) AS rentals,
               ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
         FROM category c
         JOIN film_category fc ON c.category_id=fc.category_id
         JOIN film f ON fc.film_id=f.film_id
         JOIN inventory i ON f.film_id=i.film_id
         LEFT JOIN rental r ON i.inventory_id=r.inventory_id
         LEFT JOIN payment p ON r.rental_id=p.rental_id
         GROUP BY c.name ORDER BY ${y_col} ${sortDir}`;
  } else if (/\bcountr|\bnegara/.test(p)) {
    x_col='country'; y_col=byRev?'revenue':'rentals';
    title=`Top ${lim} Countries by ${byRev?'Revenue':'Rentals'}`;
    chartType=chartType==='bar'?'horizontal_bar':chartType;
    sql=`SELECT co.country, COUNT(r.rental_id) AS rentals,
               ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
         FROM country co JOIN city ci ON co.country_id=ci.country_id
         JOIN address a ON ci.city_id=a.city_id
         JOIN customer c ON a.address_id=c.address_id
         JOIN rental r ON c.customer_id=r.customer_id
         LEFT JOIN payment p ON r.rental_id=p.rental_id
         GROUP BY co.country ORDER BY ${y_col} ${sortDir} LIMIT ${lim}`;
  } else if (/\bactor|\bactress/.test(p)) {
    x_col='actor'; y_col='total_rentals';
    title=`Top ${lim} Actors by Rentals`;
    chartType=chartType==='bar'?'horizontal_bar':chartType;
    sql=`SELECT a.first_name||' '||a.last_name AS actor,
               COUNT(DISTINCT fa.film_id) AS films,
               COUNT(r.rental_id) AS total_rentals
         FROM actor a JOIN film_actor fa ON a.actor_id=fa.actor_id
         JOIN inventory i ON fa.film_id=i.film_id
         LEFT JOIN rental r ON i.inventory_id=r.inventory_id
         GROUP BY a.actor_id,a.first_name,a.last_name
         ORDER BY total_rentals ${sortDir} LIMIT ${lim}`;
  } else if (/\bhour|\bjam/.test(p)) {
    x_col='hour'; y_col=byRev?'revenue':'rentals';
    title=`Rentals by Hour of Day`; chartType='line';
    sql=`SELECT EXTRACT(HOUR FROM rental_date)::int||':00' AS hour,
               COUNT(*) AS rentals,
               ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
         FROM rental r LEFT JOIN payment p ON r.rental_id=p.rental_id
         GROUP BY 1 ORDER BY EXTRACT(HOUR FROM rental_date)::int`;
  } else if (/\bday|\bhari|\bweek/.test(p)) {
    x_col='day'; y_col=byRev?'revenue':'rentals';
    title=`${byRev?'Revenue':'Rentals'} by Day of Week`;
    sql=`SELECT TO_CHAR(rental_date,'Day') AS day, COUNT(*) AS rentals,
               ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
         FROM rental r LEFT JOIN payment p ON r.rental_id=p.rental_id
         GROUP BY TO_CHAR(rental_date,'Day'),EXTRACT(DOW FROM rental_date)
         ORDER BY EXTRACT(DOW FROM rental_date)`;
  } else if (/\bmonth|\bbulan|\bmonthly/.test(p)) {
    x_col='month'; y_col='revenue'; chartType='line';
    title='Monthly Revenue Trend';
    sql=`SELECT TO_CHAR(DATE_TRUNC('month',r.rental_date),'YYYY-MM') AS month,
               ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
         FROM rental r LEFT JOIN payment p ON r.rental_id=p.rental_id
         GROUP BY 1 ORDER BY 1`;
  } else if (/\bstore/.test(p)) {
    x_col='store'; y_col=byRev?'revenue':'rentals';
    title=`Store ${byRev?'Revenue':'Rentals'} Comparison`;
    sql=`SELECT 'Store '||i.store_id AS store, COUNT(r.rental_id) AS rentals,
               ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
         LEFT JOIN payment p ON r.rental_id=p.rental_id
         GROUP BY i.store_id ORDER BY ${y_col} DESC`;
  }

  if (!sql) return null;

  try {
    const resp = await fetch('/api/_dq', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({sql: sql.replace(/\s+/g,' ').trim()})
    });
    const data = await resp.json();
    if (data.error) return `⚠️ Chart data error: **${data.error}**`;
    if (!data.rows?.length) return `📊 No data found for: **${title}**`;

    const x_vals = data.rows.map(r => String(r[x_col] ?? r[data.cols[0]] ?? ''));
    const y_vals = data.rows.map(r => {
      const v = r[y_col] ?? r[data.cols[1]] ?? 0;
      return typeof v === 'number' ? v : parseFloat(v)||0;
    });

    _renderCustomChart({
      chart_id: `cc-${Date.now()%9999999}`,
      title, chart_type: chartType, color: '#EC4899',
      x_col, y_col, x_vals, y_vals, rows: data.rows.length
    });
    return `✅ **Chart created: "${title}"**\n\n${data.rows.length} data points. See the **🤖 AI-Generated Charts** section below.`;
  } catch(e) {
    return `⚠️ Failed to create chart: ${e.message}`;
  }
}

function _formatQueryResult(data, label) {
  if (data.error) return `⚠️ Query error: ${data.error}`;
  const rows = data.rows || [];
  if (!rows.length) return `📊 **No results found.**\n\n*${label}*`;
  const cols = data.cols || Object.keys(rows[0]);

  const colLabels = cols.map(c => c.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase()));
  let table = `## 👥 ${label}\n*${data.count > 30 ? 'Showing top 30 of '+data.count : data.count+' result'+(data.count!==1?'s':'')} found*\n\n`;
  table += `| # | ${colLabels.join(' | ')} |\n|---|${cols.map(()=>'---').join('|')}|\n`;
  rows.forEach((r,i) => {
    const vals = cols.map(c => {
      const v = r[c];
      if (v===null||v===undefined) return '—';
      if (/spent|revenue|rate|avg_rate/.test(c) && typeof v==='number') return `**$${Number(v).toFixed(2)}**`;
      return String(v);
    });
    table += `| ${i+1} | ${vals.join(' | ')} |\n`;
  });
  if (rows.length > 0) {
    const top = rows[0];
    table += `\n💡 **Takeaway:** Top result is **${top.customer||top[cols[0]]}** `;
    if (top.total_spent) table += `with **$${Number(top.total_spent).toFixed(2)}** total spent`;
    if (top.total_rentals) table += ` across **${top.total_rentals}** rentals`;
    table += '.';
  }
  return table;
}

// ══════════════════════════════════════════════════════
//  THINKING GENERATOR
// ══════════════════════════════════════════════════════
function _generateThinking(p) {
  if (/\bforecast|\bprediksi|\bfuture|\bpredict/.test(p))
    return `Analysing forecast data and ML model performance...\nChecking revenue trend direction and confidence interval spread.\nSelecting most relevant forecast context for this query.`;
  if (/\bstore|\brevenue|\bsales|\bpendapatan/.test(p))
    return `Querying store performance metrics from database...\nComparing Store 1 vs Store 2 revenue and rental counts.\nCalculating revenue per rental ratio for each store.`;
  if (/\bcustomer|\bpelanggan|\bsegment/.test(p))
    return `Analysing customer segmentation and spending patterns...\nLooking up top customers by lifetime value.\nChecking geographic distribution of high-value customers.`;
  if (/\bcategor|\bgenre|\binventor/.test(p))
    return `Scanning category performance data...\nRanking by revenue-per-inventory-unit efficiency.\nIdentifying underperforming vs high-ROI categories.`;
  if (/\bpattern|\bhour|\bday|\bweek/.test(p))
    return `Analysing temporal rental patterns...\nChecking peak hour and best day-of-week from historical data.\nCorrelating rental volume with revenue by time slot.`;
  if (/\brecommend|\bincrease|\bboost|\bimprove/.test(p))
    return `Evaluating business improvement opportunities...\nCross-referencing slow inventory with high-demand categories.\nIdentifying geographic and temporal gaps in revenue.`;
  if (/\bcreate|chart|grafik|graph/.test(p))
    return `Parsing chart request: detecting entity, metric, and chart type...\nBuilding SQL query for the requested data.\nPreparing Plotly visualization config.`;
  if (/\bcolor|warna|move|pindah|rename|ganti/.test(p))
    return `Processing dashboard customization request...\nLocating target chart element in DOM.\nApplying change and saving to persistent state.`;
  if (/\bshow|find|list|tampilkan|cari/.test(p))
    return `Parsing query parameters: entity, filters, sort order...\nConstructing optimized SQL with appropriate JOINs.\nFormatting results for display.`;
  return `Processing request and retrieving relevant data...\nAnalysing against dashboard context.\nFormulating response.`;
}

function _wrapThink(thinking, content) {
  return `<think>\n${thinking}\n</think>\n${content}`;
}

// ══════════════════════════════════════════════════════
//  AI SEND — Main entry point
// ══════════════════════════════════════════════════════
async function aiSend(text) {
  const input  = document.getElementById('ai-input');
  const prompt = (text || input.value || '').trim();
  if (!prompt) return;
  input.value = '';

  const box = document.getElementById('chatbox-overlay');
  if (!box.classList.contains('visible')) toggleChatbox();

  if (/\b(revert|undo|rollback|batalkan)\b/i.test(prompt)) { revertLastChange(); return; }

  chatHistory.push({ role: 'user', content: prompt });
  renderChat();

  const _pLow = prompt.toLowerCase();

  // ── INSTANT: handle client-side, with thinking delay so it doesn't look instant ──
  const instant = _tryInstantCommand(prompt);
  if (instant) {
    appendLoading(prompt);
    // Vary delay: longer for analytical questions, shorter for UI commands
    const isAnalytical = /\b(why|what|how|explain|cause|compare|analyse|analyze|which|who|when)\b/i.test(prompt);
    const delay = isAnalytical ? 1800 + Math.random()*1200 : 800 + Math.random()*600;
    await new Promise(r => setTimeout(r, delay));
    removeLoading();
    const _think = _generateThinking(_pLow);
    chatHistory.push({ role: 'assistant', content: _wrapThink(_think, instant.message), model_used: 'instant ⚡' });
    renderChat();
    return;
  }

  // ── DIRECT CHART CREATION: no LLM needed ──
  if (/\b(?:create|make|add|buat|tambahkan|generate)\b/i.test(prompt) &&
      /\b(?:chart|graph|grafik)\b/i.test(prompt)) {
    appendLoading(prompt);
    const chartMsg = await _tryCreateChart(prompt);
    removeLoading();
    if (chartMsg) {
      const _think = _generateThinking(_pLow);
      chatHistory.push({ role:'assistant', content: _wrapThink(_think, chartMsg), model_used:'direct ⚡' });
      renderChat(); return;
    }
  }

  // ── DIRECT DB QUERY: natural language → SQL, no LLM needed ──
  const directSQL = _buildDirectSQL(prompt);
  if (directSQL) {
    appendLoading(prompt);
    try {
      const dr = await fetch(API + '/api/_dq', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({sql: directSQL.sql})
      });
      removeLoading();
      const dd = await dr.json();
      if (!dd.error) {
        const _think = _generateThinking(_pLow);
        chatHistory.push({ role:'assistant', content: _wrapThink(_think, _formatQueryResult(dd, directSQL.label)), model_used:'direct DB ⚡' });
        renderChat(); return;
      }
    } catch(e) { removeLoading(); }
  }

  // ── OFF-TOPIC GUARD — redirect before wasting an LLM call ──
  const _DASHBOARD_KW = /\b(revenue|sales|rental|rent|customer|film|movie|dvd|store|forecast|predict|category|inventory|stock|country|region|geo|pattern|hour|day|week|staff|actor|chart|graph|dashboard|insight|trend|profit|income|payment|transaction|report|analys|kpi|performance|recommend|strategy|compare|top|best|worst|highest|lowest|grow|declin|drop|spike|loyal|churn|segment|overstock|slow.mov|turnover|busiest|peak|average|monthly|weekly|daily|annual|model|lstm|transformer|arima|xgboost|mae|rmse|mape|r2|overfitting|ensemble|confidence|leaderboard|ranking)\b/i;
  if (!_DASHBOARD_KW.test(_pLow)) {
    appendLoading(prompt);
    await new Promise(r => setTimeout(r, 1000 + Math.random()*500));
    removeLoading();
    const _offtopicThink = `User asked: "${prompt.slice(0,60)}"\nChecking relevance to DVD rental analytics dashboard...\nNo dashboard-related keywords detected (revenue, rental, customer, film, store, forecast, etc.)\nThis question is outside the scope of Store Analytics Pro.\nRedirecting user to relevant topics.`;
    chatHistory.push({ role: 'assistant', content: _wrapThink(_offtopicThink,
      `## 🎬 I'm your DVD Rental Analytics AI\n\nI can only answer questions related to **Store Analytics Pro** — the DVD rental dashboard.\n\nTry asking me about:\n\n**📊 Business Data**\n- *"What is our total revenue and which store performs better?"*\n- *"Which categories generated the highest revenue?"*\n- *"Who are the top 10 customers by spending?"*\n\n**🔮 Forecasting & ML**\n- *"What is MAE and why does it matter?"*\n- *"Why does Transformer underperform Linear Regression?"*\n- *"How accurate is our forecast?"*\n\n**📈 Analytics**\n- *"What caused the revenue drop this month?"*\n- *"What is our busiest hour and best day for rentals?"*\n- *"Show customers in India with rent cost more than $100"*\n\n**🎛️ Dashboard Control**\n- *"Change store revenue color to blue"*\n- *"Create a bar chart of top 10 films by rentals"*\n- *"Go to forecast tab"*`) , model_used: 'instant ⚡'});
    renderChat();
    return;
  }

  // ── AI AGENT ──
  appendLoading(prompt);
  try {
    const r = await fetch(API + '/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        history: chatHistory.slice(-8).slice(0, -1),
        model: document.getElementById('ai-model').value,
        store: document.getElementById('store-filter')?.value || 'All',
        month: document.getElementById('month-filter')?.value || 'All',
      }),
    });
    removeLoading();
    const d = await r.json();
    if (d.error) {
      chatHistory.push({ role: 'assistant', content: `⚠️ ${d.error}` });
    } else {
      let _agentContent = d.response || '';
      // Add thinking if LLM didn't provide its own <think> block
      if (!_agentContent.includes('<think>')) {
        _agentContent = _wrapThink(_generateThinking(_pLow), _agentContent);
      }
      chatHistory.push({
        role: 'assistant',
        content: _agentContent,
        model_used: d.model_used,
        patches: d.patches || [],
      });
      if (d.charts && d.charts.length) {
        d.charts.forEach(c => _renderCustomChart(c));
        showToast(`${d.charts.length} chart${d.charts.length>1?'s':''} added to dashboard!`, 'success', 3000);
      }
    }
  } catch (e) {
    removeLoading();
    chatHistory.push({ role: 'assistant', content: `⚠️ Network error: ${e.message}` });
  }
  renderChat();
}

function aiQuick(text) { aiSend(text); }
function aiClear()     { chatHistory = []; renderChat(); }

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderChat() {
  const el = document.getElementById('ai-chat');
  if (!el) return;
  if (!chatHistory.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:32px 16px">
        <div style="font-size:2.5rem;margin-bottom:10px">🤖</div>
        <div style="font-size:.9rem;font-weight:800;margin-bottom:10px;background:linear-gradient(90deg,var(--pink-hot),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent">AI Dashboard Controller</div>
        <div class="muted-text" style="font-size:.71rem;line-height:1.85;text-align:left">
          <b style="color:var(--ok)">⚡ INSTANT (no loading):</b><br>
          <b>Navigate:</b> "go to customers tab" · "open forecast" · "buka inventory"<br>
          <b>Scroll:</b> "go to Store Revenue chart" · "scroll to Global Revenue Map"<br>
          <b>Charts:</b> "store revenue pie" · "customer distribution bar" · "revenue trend line"<br>
          <b>Layout:</b> "move KPI to bottom/top" · "make KPI bigger" · "hide KPI cards"<br>
          <b>Theme:</b> "dark navy" · "purple gold" · "ocean" · "midnight" · "sunset" · "forest"<br>
          <b>Color:</b> "accent green/orange/blue" · "background purple" · "accent #ff6b35"<br>
          <b>KPI:</b> "set revenue to $3 million" · "dark mode" · "reset dashboard"<br><br>
          <b style="color:var(--accent)">🤖 AI Business Intelligence (needs API key):</b><br>
          <b>Revenue:</b> "What caused the revenue drop?" · "Show revenue trend by month"<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"Which store contributes the most revenue?" · "Compare stores"<br>
          <b>Customers:</b> "Who are the top spending customers?" · "Loyal customers by country"<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"Which customers are likely to churn?" · "Customer CLV analysis"<br>
          <b>Inventory:</b> "Which products are slow-moving?" · "Show overstock items"<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"Top 10 best-selling films" · "Highest inventory turnover rate"<br>
          <b>Patterns:</b> "What is our busiest hour and best day?" · "Peak rental time"<br>
          <b>Forecast:</b> "Predict revenue for next 3 months" · "Explain forecast trend"<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"Compare Transformer vs LSTM forecast" · "Is trend growing or declining?"<br>
          <b>Strategy:</b> "Give me 5 recommendations to increase sales"<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"Which categories are underperforming?" · "What should I focus on?"<br>
          <b>Analysis:</b> "Why did profit decrease despite higher sales?"<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"What are the hidden insights here?" · "Business risks emerging?"<br>
          <b>Charts:</b> "Change this bar chart to pie" · "Show data as heatmap"<br><br>
          <b style="color:#F59E0B">💡 Pro Tips:</b><br>
          • Hover any chart → toolbar (type change, insight, delete)<br>
          • Drag chart cards to reorder the dashboard<br>
          • Stay on a chart 15s → AI proactively shares insight!<br>
        </div>
      </div>`;
    return;
  }
  el.innerHTML = chatHistory.map((m, idx) => {
    if (m.role === 'user') {
      return `<div class="ai-msg user">🧑‍💼 ${escHtml(m.content)}</div>`;
    }
    let raw = m.content;
    let thinkHtml = '';
    const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinkHtml = `<details class="ai-think"><summary>🧠 View AI Reasoning</summary><pre>${thinkMatch[1].trim()}</pre></details>`;
      raw = raw.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    }

    let topicHtml = '';
    if (idx > 0 && chatHistory[idx-1].role === 'user') {
      const topics = detectTopics(chatHistory[idx-1].content);
      topicHtml = `<div class="ai-analysis-box">
        <div class="analysis-label">🔍 Analysed</div>
        <div class="analysis-items">${topics.map(t=>`<span>${t}</span>`).join('')}</div>
      </div>`;
    }

    const contentHtml = typeof marked !== 'undefined' ? marked.parse(raw) : raw;
    const modelTag = m.model_used ? `<div style="font-size:.6rem;color:var(--muted);margin-top:6px;text-align:right">Model: ${m.model_used}</div>` : '';

    let patchHtml = '';
    if (m.patches && m.patches.length > 0) {
      const cardId = 'patch-' + idx + '-' + Date.now();
      window._agentPatches.set(cardId, m.patches);
      patchHtml = `<div class="patch-card">
        <div class="patch-header">📝 Proposed Code Changes (${m.patches.length})</div>
        ${m.patches.map(p => `<div class="patch-item">
          <div class="patch-file">📄 <strong>${p.file}</strong> — ${escHtml(p.reason||'')}</div>
          <pre class="patch-old">- ${escHtml((p.old_str||'').substring(0,250))}</pre>
          <pre class="patch-new">+ ${escHtml((p.new_str||'').substring(0,250))}</pre>
        </div>`).join('')}
        <div class="patch-actions">
          <button class="btn-primary" style="font-size:.72rem;padding:5px 14px" onclick="applyAgentPatches('${cardId}')">✅ Apply Changes</button>
          <button class="btn-outline" style="font-size:.72rem;padding:5px 14px" onclick="cancelPatch('${cardId}')">✕ Reject</button>
        </div>
      </div>`;
    }

    return `<div class="ai-msg assistant">🤖 ${topicHtml}${thinkHtml}${contentHtml}${patchHtml}${modelTag}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function applyAgentPatches(cardId) {
  const patches = window._agentPatches.get(cardId);
  if (!patches) return;
  try {
    const r = await fetch(API + '/api/agent_apply', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({patches}),
    });
    const d = await r.json();
    window._agentPatches.delete(cardId);
    if (d.errors && d.errors.length) {
      showToast('Some patches failed: ' + d.errors.join(', '), 'error');
    }
    if (d.applied && d.applied.length) {
      showToast('✅ Applied! Reloading...', 'success');
      setTimeout(() => location.reload(), 1500);
    }
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

function cancelPatch(cardId) {
  window._agentPatches.delete(cardId);
  showToast('Changes rejected', 'info');
  renderChat();
}

async function revertLastChange() {
  const files = ['static/style.css', 'static/app.js', 'templates/index.html', 'static/enhanced.css'];
  showToast('Reverting last change...', 'info');
  const results = await Promise.all(files.map(f =>
    fetch(API+'/api/agent_revert',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({file:f})}).then(r=>r.json()).catch(()=>({}))
  ));
  const reverted = results.filter(r=>r.reverted).map(r=>r.reverted);
  if (reverted.length) {
    showToast(`Reverted: ${reverted.join(', ')}. Reloading...`, 'success');
    setTimeout(() => location.reload(), 1500);
  } else {
    showToast('No backups found', 'warning');
  }
}

function appendLoading(prompt) {
  const el = document.getElementById('ai-chat');
  const topics = detectTopics(prompt);
  const topicHtml = `<div class="ai-analysis-box">
    <div class="analysis-label">🔍 Analysing</div>
    <div class="analysis-items">${topics.map(t=>`<span>${t}</span>`).join('')}</div>
  </div>`;
  el.innerHTML += `<div id="ai-loading" class="ai-msg assistant">
    <span class="spinner"></span> Agent is working...
    ${topicHtml}
  </div>`;
  el.scrollTop = el.scrollHeight;
}
function removeLoading() { const el = document.getElementById('ai-loading'); if (el) el.remove(); }

// ══════════════════════════════════════════════════════
//  PROVIDER STATUS
// ══════════════════════════════════════════════════════
async function detectProvider() {
  try {
    const r = await fetch(API + '/api/provider_status');
    const d = await r.json();
    const badge    = document.getElementById('ai-provider-badge');
    const modelSel = document.getElementById('ai-model');
    const active   = d.active_provider;

    if (!badge) return;

    if (active === 'kimi') {
      badge.textContent = '· ✅ Kimi Active';
      badge.style.color = '#86EFAC';
      if (modelSel) modelSel.innerHTML = `
        <option value="moonshot-v1-8k">Kimi moonshot-v1-8k ✅</option>
        <option value="moonshot-v1-32k">Kimi moonshot-v1-32k</option>`;
    } else if (active === 'groq') {
      badge.textContent = '· ✅ Groq Active (fallback)';
      badge.style.color = '#86EFAC';
      if (modelSel) modelSel.innerHTML = `
        <option value="llama-3.3-70b-versatile">Groq Llama 3.3 70B ✅</option>
        <option value="llama-3.1-8b-instant">Groq Llama 3.1 8B (Fast)</option>
        <option value="gemma2-9b-it">Groq Gemma2 9B</option>`;
    } else if (active === 'gemini') {
      badge.textContent = '· ✅ Gemini Active (fallback)';
      badge.style.color = '#86EFAC';
      if (modelSel) modelSel.innerHTML = `
        <option value="gemini-1.5-flash">Gemini 1.5 Flash ✅</option>
        <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>`;
    } else {
      badge.textContent = '· ❌ No provider — click to fix';
      badge.style.color = '#EF4444';
      badge.style.cursor = 'pointer';
      chatHistory = [{
        role: 'assistant',
        content: `## ❌ No AI Provider Working\n\nBoth Kimi and Groq keys have expired.\n\n**Get a FREE key in 30 seconds:**\n\n### Option 1 — Groq (Fastest)\n1. Go to **https://console.groq.com**\n2. Sign up → API Keys → Create API Key\n3. Add to **.env**: \`GROQ_API_KEY=gsk_...\`\n4. Restart Flask\n\n### Option 2 — Gemini (1500 free req/day)\n1. Go to **https://aistudio.google.com**\n2. Get API Key → copy it\n3. Add to **.env**: \`GEMINI_API_KEY=AIza...\`\n4. Restart Flask`,
      }];
      renderChat();
    }
  } catch(e) {
    console.warn('Provider check failed:', e);
  }
}

// ══════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════
async function saveDbConfig() {
  const st = document.getElementById('db-status');
  st.className = 'db-status'; st.textContent = 'Connecting...';
  try {
    const r = await fetch(API + '/api/db_config', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        host: document.getElementById('db-host').value,
        database: document.getElementById('db-name').value,
        user: document.getElementById('db-user').value,
        password: document.getElementById('db-pass').value,
      }),
    });
    const d = await r.json();
    if (d.status === 'ok') { st.className = 'db-status ok'; st.textContent = '✅ ' + d.message; refreshAll(); }
    else { st.className = 'db-status err'; st.textContent = '❌ ' + d.message; }
  } catch (e) { st.className = 'db-status err'; st.textContent = '❌ ' + e.message; }
}

async function loadDbConfig() {
  try {
    const r = await fetch(API + '/api/db_config');
    const d = await r.json();
    document.getElementById('db-host').value = d.host || '';
    document.getElementById('db-name').value = d.database || '';
    document.getElementById('db-user').value = d.user || '';
  } catch (e) {}
}

async function runCustomQuery() {
  const sql = document.getElementById('custom-sql').value.trim();
  const el  = document.getElementById('query-result');
  if (!sql) { el.innerHTML = '<p class="muted-text">Enter a query first.</p>'; return; }
  el.innerHTML = '<span class="spinner"></span> Running...';
  try {
    const r = await fetch(API + '/api/custom_query', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({sql}),
    });
    const d = await r.json();
    if (d.error) { el.innerHTML = `<p style="color:#EF4444">${d.error}</p>`; return; }
    let html = `<p class="muted-text">${d.total_rows} rows · showing max 500</p>
      <table class="data-table"><thead><tr>
        ${d.columns.map(c=>`<th>${c}</th>`).join('')}
      </tr></thead><tbody>`;
    d.data.forEach(row => {
      html += '<tr>' + d.columns.map(c=>`<td>${row[c]!=null?row[c]:''}</td>`).join('') + '</tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<p style="color:#EF4444">${e.message}</p>`; }
}

// ══════════════════════════════════════════════════════
//  CHART / SECTION RESIZE HANDLES
// ══════════════════════════════════════════════════════
function _initResizeHandles() {
  document.querySelectorAll('.chart-card').forEach(card => {
    if (card._resizeInited) return;
    card._resizeInited = true;
    card.style.resize = 'both';
    card.style.overflow = 'auto';
    card.style.minWidth = '200px';
    card.style.minHeight = '180px';
    card.style.boxSizing = 'border-box';
    // Add resize observer to re-render plotly on resize
    const ro = new ResizeObserver(() => {
      const chartEl = card.querySelector('.js-plotly-plot');
      if (chartEl) Plotly.Plots.resize(chartEl);
    });
    ro.observe(card);
    // Add a visual resize hint
    const hint = document.createElement('div');
    hint.className = 'resize-hint';
    hint.title = 'Drag corner to resize';
    hint.innerHTML = '⤢';
    card.appendChild(hint);
  });
}

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════
(async function init() {
  applyTheme();
  await loadMonths();
  loadDbConfig();
  refreshAll();
  renderChat();
  detectProvider();

  // After charts load, init drag & drop + proactive watcher + toolbars
  setTimeout(() => {
    _initDragDrop();
    _initProactiveWatcher();
    _initKpiDrag();
    _initResizeHandles();
    _updateRestoreButton();
    _restoreCustomCharts();
  }, 2500);
  // Re-init KPI drag after KPI loads
  setTimeout(_initKpiDrag, 3500);
})();
