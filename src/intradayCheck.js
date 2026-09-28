const { buildLevelsForWatchlist } = require('./levels');
const { fetchQuotes } = require('./intradayQuotes');
const { fetchTxfSummary } = require('./twFutures');
const { loadAllDays } = require('../backtest/loadCache');
const { buildSeriesByCode } = require('../backtest/buildSeries');
const { annotateSeries } = require('../backtest/indicators');
const { loadNameMap, stockLabel } = require('./stockNames');

function fmt(n) {
  return n == null ? '－' : n.toFixed(2);
}

// 用已收盤資料算每檔股票目前的20日均線（跟回測「跌破20日均線才算轉弱」用同一套邏輯，
// 不受盤中即時價的雜訊影響）
function getMa20Map(codes) {
  const days = loadAllDays();
  const seriesMap = buildSeriesByCode(days, codes);
  const map = new Map();
  for (const code of codes) {
    const series = seriesMap.get(code);
    if (!series || series.length < 20) continue;
    annotateSeries(series);
    map.set(code, series[series.length - 1].ma20);
  }
  return map;
}

function buildStockLine(label, quote, level, ma20) {
  if (!quote) return `${label}　報價取得失敗`;
  if (!level || level.error) return `${label}　現價 ${fmt(quote.close)}（無支撐壓力資料）`;

  const flags = [];
  if (level.stopLoss != null && quote.close <= level.stopLoss) flags.push('🔴 已跌破停損！');
  else if (ma20 != null && quote.close < ma20) flags.push('⚠️ 跌破20日均線（波段轉弱訊號）');
  if (level.r1 != null && quote.close >= level.r1) flags.push('🚀 站上壓力');

  const sign = quote.changePct > 0 ? '+' : '';
  const flagText = flags.length ? `　${flags.join('　')}` : '';
  return `${label}　現價 ${fmt(quote.close)}（${sign}${quote.changePct.toFixed(2)}%）｜20MA ${fmt(ma20)}｜壓力 ${fmt(level.r1)}｜停損 ${fmt(level.stopLoss)}${flagText}`;
}

// 回傳 { text, hasBreach }；hasBreach 用來讓排程決定「平靜時是否還要推播」
async function buildIntradayMessage(today) {
  const levels = await buildLevelsForWatchlist(today.watchlist, today.stopLossPct);
  const levelByCode = new Map(levels.map((l) => [l.code, l]));

  const [quotes, txf] = await Promise.all([
    fetchQuotes(today.watchlist).catch(() => new Map()),
    fetchTxfSummary().catch(() => null),
  ]);
  const ma20Map = getMa20Map(today.watchlist);
  const nameMap = loadNameMap();

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  const txfLine = txf
    ? `台指期：${fmt(txf.close)}（${txf.changePct > 0 ? '+' : ''}${txf.changePct.toFixed(2)}%）`
    : '台指期：資料取得失敗';

  const stockLines = today.watchlist.map((code) =>
    buildStockLine(stockLabel(code, nameMap), quotes.get(code), levelByCode.get(code), ma20Map.get(code))
  );

  const hasBreach = today.watchlist.some((code) => {
    const q = quotes.get(code);
    const l = levelByCode.get(code);
    return q && l && !l.error && l.stopLoss != null && q.close <= l.stopLoss;
  });

  const text = [
    `⏱ 盤中檢查（${hh}:${mm}，報價約15分鐘延遲）`,
    txfLine,
    ...stockLines,
  ].join('\n');

  return { text, hasBreach };
}

module.exports = { buildIntradayMessage };
