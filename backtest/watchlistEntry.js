const { backfillRecentDays } = require('./backfillHistory');
const { loadRecentDays, dataSourceNote } = require('./loadCache');
const { buildUniverse } = require('./universe');
const { buildSeriesByCode } = require('./buildSeries');
const { annotateSeries } = require('./indicators');
const {
  buildSortedRet20ByDate,
  evaluateEntryConditions,
  DEFAULT_RS_PERCENTILE,
  VOLUME_SURGE_MULTIPLE,
} = require('./strategy');
const { calcPivotPoints, calcStopLoss } = require('../src/pivotPoints');

// 季線走揚要比較 5 日前的 60 日均線（需第 65 根K棒），再多留一點餘裕；
// 只讀最近這幾天的快取，避免把整份歷史載入記憶體（雲端免費方案記憶體很小）。
const LOOKBACK_DAYS = 90;
const MIN_BARS = 66;

// 對觀察名單逐檔檢查「選股」用的同一套進場條件，回傳每一項是否成立、差多少、下一交易日的觸發價。
// 相對強度一樣是跟流動性前150大股票池比較 20 日報酬排名。
async function checkWatchlistEntry(codes, { stopLossPct = 20, topN = 150, rsPercentile = DEFAULT_RS_PERCENTILE } = {}) {
  await backfillRecentDays(10).catch((err) => console.error('[watchlistEntry] 回補失敗:', err.message));

  const days = loadRecentDays(LOOKBACK_DAYS);
  if (days.length < MIN_BARS) {
    throw new Error(`快取資料只有 ${days.length} 個交易日，不足以計算季線，請稍後再試`);
  }

  const latestDate = days[days.length - 1].date;
  const universeCodes = buildUniverse(days, { topN, minCoverage: 0.9 }).map((u) => u.code);
  const seriesMap = buildSeriesByCode(days, [...new Set([...universeCodes, ...codes])]);
  for (const s of seriesMap.values()) annotateSeries(s);

  // 相對強度的比較基準只用股票池，不把觀察名單裡的冷門股混進去，跟「選股」一致
  const poolSeries = new Map(universeCodes.filter((c) => seriesMap.has(c)).map((c) => [c, seriesMap.get(c)]));
  const sortedRet20 = buildSortedRet20ByDate(poolSeries).get(latestDate) || [];
  const rsThresholdRet20 = sortedRet20.length
    ? sortedRet20[Math.min(sortedRet20.length - 1, Math.ceil(rsPercentile * sortedRet20.length))]
    : null;

  const nameMap = new Map(days[days.length - 1].rows.map((r) => [r.code, r.name]));

  const results = codes.map((code) => {
    const name = nameMap.get(code) || null;
    const series = seriesMap.get(code);
    if (!series || !series.length) {
      return { code, name, error: '查無上市行情資料（代號不存在，或為上櫃股票，目前不支援）' };
    }
    const last = series[series.length - 1];
    if (last.date !== latestDate) {
      return { code, name, error: `最新交易日（${latestDate}）無成交，可能暫停交易` };
    }
    if (series.length < MIN_BARS) {
      return { code, name, error: '上市未滿約 3 個月，資料不足以計算季線' };
    }

    const evaluation = evaluateEntryConditions(last, sortedRet20, rsPercentile);
    if (!evaluation) return { code, name, error: '技術指標資料不足' };

    // 下一交易日的觸發門檻：20 日視窗會變成「最近 19 天＋明天」
    const recent19 = series.slice(-19);
    const nextHigh20 = Math.max(...recent19.map((r) => r.close));
    const sumVol19 = recent19.reduce((s, r) => s + r.volume, 0);
    // v > m × (sumVol19 + v) / 20  ⇒  v > m × sumVol19 / (20 − m)
    const m = VOLUME_SURGE_MULTIPLE;
    const nextVolumeNeeded = (m * sumVol19) / (20 - m);

    const { pivot, r1, s1 } = calcPivotPoints({ high: last.high, low: last.low, close: last.close });

    return {
      code,
      name,
      date: latestDate,
      close: last.close,
      volume: last.volume,
      ma20: last.ma20,
      ma60: last.ma60,
      volAvg20: last.volAvg20,
      ret20: last.ret20,
      ...evaluation,
      nextHigh20,
      nextVolumeNeeded,
      pivot,
      resistance: r1,
      support: s1,
      stopLoss: calcStopLoss(s1, stopLossPct),
    };
  });

  return { date: latestDate, poolSize: sortedRet20.length, rsPercentile, rsThresholdRet20, results, dataNote: dataSourceNote(days.slice(-80)) };
}

module.exports = { checkWatchlistEntry };
