const { loadAllDays } = require('../backtest/loadCache');
const { buildSeriesByCode } = require('../backtest/buildSeries');
const { annotateSeries } = require('../backtest/indicators');

function parseDateToMs(yyyymmdd) {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return Date.UTC(y, m, d);
}

// 回傳 QuickChart 短網址（免費第三方圖表服務，不需金鑰），抓不到資料回傳 null
async function buildCandlestickUrl(code, windowDays = 60) {
  const days = loadAllDays();
  const seriesMap = buildSeriesByCode(days, [code]);
  const series = seriesMap.get(code);
  if (!series || series.length === 0) return null;

  const name = days[days.length - 1].rows.find((r) => r.code === code)?.name || code;

  annotateSeries(series);
  const slice = series.slice(-windowDays);

  const candles = slice.map((r) => ({
    x: parseDateToMs(r.date),
    o: r.open,
    h: r.high,
    l: r.low,
    c: r.close,
  }));
  const ma20Line = slice
    .filter((r) => r.ma20 != null)
    .map((r) => ({ x: parseDateToMs(r.date), y: r.ma20 }));

  const chart = {
    version: '4',
    chart: {
      type: 'candlestick',
      data: {
        datasets: [
          { label: `${code} ${name}`, data: candles },
          {
            type: 'line',
            label: '20日均線',
            data: ma20Line,
            borderColor: '#3b82f6',
            borderWidth: 1.5,
            pointRadius: 0,
          },
        ],
      },
      options: {
        scales: {
          x: { type: 'time', time: { unit: 'week' } },
        },
      },
    },
  };

  const res = await fetch('https://quickchart.io/chart/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chart),
  });
  if (!res.ok) throw new Error(`QuickChart HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error('QuickChart 產生失敗');
  return json.url;
}

module.exports = { buildCandlestickUrl };
