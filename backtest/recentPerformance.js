// 「戰績」：用最近的真實每日行情，重跑「選股」在每一天會給出的訊號，並照出場規則追蹤到今天。
// 訊號是由當天收盤資料決定的（同一套程式、同一份資料，結果是確定的），
// 所以不必另外存訊號紀錄，就能知道過去每天「選股」會列出哪些股票、後來表現如何。
const { loadRecentDays, dataSourceNote } = require('./loadCache');
const { buildUniverse } = require('./universe');
const { buildSeriesByCode } = require('./buildSeries');
const { runBacktest } = require('./engine');
const { summarize } = require('./report');
const { ensureHistory } = require('./yahooHistory');

// 讀最近這麼多個交易日；前 WARMUP_BARS 天只用來算均線（季線走揚要 65 根K棒），不計入訊號期間
const LOAD_DAYS = 200;
const WARMUP_BARS = 65;

let memo = { latestDate: null, result: null };

async function computeRecentPerformance() {
  await ensureHistory(loadRecentDays, WARMUP_BARS + 10);
  const days = loadRecentDays(LOAD_DAYS);
  if (days.length < WARMUP_BARS + 10) {
    throw new Error(`快取資料只有 ${days.length} 個交易日，不足以統計戰績，請稍後再試`);
  }
  const latestDate = days[days.length - 1].date;
  if (memo.latestDate === latestDate) return memo.result; // 同一天的資料算一次就好（要跑整個股票池，有點重）

  const universe = buildUniverse(days, { topN: 150, minCoverage: 0.9 });
  const seriesMap = buildSeriesByCode(days, universe.map((u) => u.code));
  const { trades } = runBacktest(seriesMap, universe, { includeOpen: true });

  const periodStart = days[WARMUP_BARS].date;
  const inPeriod = trades.filter((t) => t.entryDate >= periodStart);
  const closed = inPeriod.filter((t) => t.reason !== 'open');
  const open = inPeriod.filter((t) => t.reason === 'open');

  const result = {
    dataNote: dataSourceNote(days),
    periodStart,
    periodEnd: latestDate,
    tradingDays: days.length - WARMUP_BARS,
    universeSize: universe.length,
    signalCount: inPeriod.length,
    closedStats: summarize(closed),
    openStats: summarize(open),
    open: open.sort((a, b) => b.entryDate.localeCompare(a.entryDate)),
    recentClosed: closed.sort((a, b) => b.exitDate.localeCompare(a.exitDate)).slice(0, 5),
  };
  memo = { latestDate, result };
  return result;
}

module.exports = { computeRecentPerformance };
