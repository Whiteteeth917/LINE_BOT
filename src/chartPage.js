// 互動 K 線頁：/chart/:code?sl=20
// 用 TradingView 官方開源的 Lightweight Charts（Apache-2.0，需標註出處）在瀏覽器端畫圖，
// 資料（K 線、20 日均線、樞紐點支撐／壓力、停損）由伺服器算好後直接嵌進頁面，
// 使用者打開連結就能看到「已經畫好線」的圖，可拖曳、縮放。
const { loadRecentDays } = require('../backtest/loadCache');
const { buildSeriesByCode } = require('../backtest/buildSeries');
const { annotateSeries } = require('../backtest/indicators');
const { buildLevelsForWatchlist } = require('./levels');

const CHART_DAYS = 120;
const LOOKBACK_DAYS = CHART_DAYS + 25; // 20 日均線往前需要的資料

const CODE_PATTERN = /^[0-9]{4,6}[A-Z]?$/;

function isValidCode(code) {
  return CODE_PATTERN.test(code);
}

function toIsoDate(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

async function buildChartData(code, stopLossPct) {
  const days = loadRecentDays(LOOKBACK_DAYS);
  if (!days.length) return null;

  const series = buildSeriesByCode(days, [code]).get(code);
  if (!series || !series.length) return null;
  annotateSeries(series);

  const name = days[days.length - 1].rows.find((r) => r.code === code)?.name || '';
  const slice = series.slice(-CHART_DAYS);

  const [level] = await buildLevelsForWatchlist([code], stopLossPct).catch(() => [null]);

  return {
    code,
    name,
    stopLossPct,
    candles: slice.map((r) => ({ time: toIsoDate(r.date), open: r.open, high: r.high, low: r.low, close: r.close })),
    volume: slice.map((r) => ({ time: toIsoDate(r.date), value: r.volume, up: r.close >= r.open })),
    ma20: slice.filter((r) => r.ma20 != null).map((r) => ({ time: toIsoDate(r.date), value: r.ma20 })),
    levels: level && !level.error
      ? { r1: level.r1, pivot: level.pivot, s1: level.s1, stopLoss: level.stopLoss, basedOn: level.ohlcDate || null }
      : null,
  };
}

// 把 JSON 安全地嵌進 <script>：避免資料中的 "</script>" 或 "<!--" 提前結束標籤
function safeJson(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderNotFound(code) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>查無資料</title><style>body{font-family:system-ui,sans-serif;background:#111418;color:#e6e6e6;display:grid;place-items:center;height:100vh;margin:0}</style></head>
<body><p>查無 ${escapeHtml(code)} 的行情資料（可能是代號錯誤，或伺服器剛啟動、行情還在下載中，請稍後再試）。</p></body></html>`;
}

function renderChartPage(data) {
  const title = `${data.code} ${data.name}`.trim();
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}｜K線</title>
<style>
  :root { --bg:#ffffff; --fg:#1f2328; --muted:#6b7280; --grid:#eef0f3; --border:#e5e7eb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111418; --fg:#e6e6e6; --muted:#9aa4b2; --grid:#1d232b; --border:#2a313a; } }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--fg); font-family:system-ui,-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif; }
  .wrap { display:flex; flex-direction:column; height:100%; }
  header { padding:12px 16px 8px; border-bottom:1px solid var(--border); }
  h1 { font-size:18px; margin:0 0 6px; }
  .legend { display:flex; flex-wrap:wrap; gap:6px 14px; font-size:13px; color:var(--muted); }
  .legend b { color:var(--fg); font-weight:600; }
  .sw { display:inline-block; width:14px; height:0; border-top:2px solid; vertical-align:middle; margin-right:4px; }
  .dash { border-top-style:dashed; }
  #chart { flex:1; min-height:320px; }
  footer { padding:6px 16px 10px; font-size:11px; color:var(--muted); }
  footer a { color:inherit; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="legend" id="legend"></div>
  </header>
  <div id="chart"></div>
  <footer>
    支撐／壓力為前一交易日樞紐點公式計算，停損＝支撐下方 ${escapeHtml(data.stopLossPct)}%；僅供參考，不構成投資建議。
    圖表由 <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noopener">TradingView Lightweight Charts</a> 繪製。
  </footer>
</div>
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>
<script>
(function () {
  var data = ${safeJson(data)};
  // 台股慣例：紅漲綠跌
  var UP = '#e5484d', DOWN = '#30a46c', MA = '#3b82f6';
  var LV = { r1: '#f59e0b', pivot: '#8b5cf6', s1: '#0ea5e9', stopLoss: '#ef4444' };
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var css = getComputedStyle(document.documentElement);
  var el = document.getElementById('chart');

  var chart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: css.getPropertyValue('--bg').trim() }, textColor: css.getPropertyValue('--muted').trim() },
    grid: { vertLines: { color: css.getPropertyValue('--grid').trim() }, horzLines: { color: css.getPropertyValue('--grid').trim() } },
    rightPriceScale: { borderColor: css.getPropertyValue('--border').trim() },
    timeScale: { borderColor: css.getPropertyValue('--border').trim() },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    localization: { locale: 'zh-TW' },
  });

  var candles = chart.addCandlestickSeries({
    upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
  });
  candles.setData(data.candles);

  var vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
  vol.setData(data.volume.map(function (v) {
    return { time: v.time, value: v.value, color: (v.up ? UP : DOWN) + (dark ? '55' : '44') };
  }));

  var ma = chart.addLineSeries({ color: MA, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  ma.setData(data.ma20);

  var legend = ['<span><span class="sw" style="border-color:' + MA + '"></span>20日均線</span>'];
  function fmt(n) { return n == null ? '－' : n.toFixed(2); }
  if (data.levels) {
    [['r1', '壓力 R1', 2], ['pivot', '樞紐 P', 1], ['s1', '支撐 S1', 2], ['stopLoss', '停損', 0]].forEach(function (d) {
      var v = data.levels[d[0]];
      if (v == null) return;
      candles.createPriceLine({ price: v, color: LV[d[0]], lineWidth: 2, lineStyle: d[2], axisLabelVisible: true, title: d[1] });
      legend.push('<span><span class="sw' + (d[2] ? ' dash' : '') + '" style="border-color:' + LV[d[0]] + '"></span>' + d[1] + ' <b>' + fmt(v) + '</b></span>');
    });
  } else {
    legend.push('<span>支撐／壓力資料暫時取得失敗</span>');
  }
  var last = data.candles[data.candles.length - 1];
  if (last) legend.unshift('<span>收盤 <b>' + fmt(last.close) + '</b>（' + last.time + '）</span>');
  document.getElementById('legend').innerHTML = legend.join('');

  // autoSize 會在下一個 frame 才量到實際寬度，太早 fitContent 會用錯的寬度算 K 棒間距，左側出現大片空白
  function fit() { chart.timeScale().fitContent(); }
  requestAnimationFrame(function () { requestAnimationFrame(fit); });
  window.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
})();
</script>
</body>
</html>`;
}

module.exports = { buildChartData, renderChartPage, renderNotFound, isValidCode };
