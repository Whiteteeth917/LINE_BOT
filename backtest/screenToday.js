const { backfillRecentDays } = require('./backfillHistory');
const { loadAllDays, dataSourceNote } = require('./loadCache');
const { buildUniverse } = require('./universe');
const { buildSeriesByCode } = require('./buildSeries');
const { annotateSeries } = require('./indicators');
const { buildSortedRet20ByDate, isEntrySignal, DEFAULT_RS_PERCENTILE } = require('./strategy');
const {
  fetchRevenueGrowthMap,
  fetchEpsMap,
  fetchWarningCodeSet,
  fetchHeavyInsiderTransferCodeSet,
} = require('./fundamentals');

// 回傳今天（最近一個交易日）符合技術面訊號的候選股，附上基本面／異常標記資訊（純呈現，不自動排除）
async function screenToday({ topN = 150, rsPercentile = DEFAULT_RS_PERCENTILE, maxResults = 10 } = {}) {
  await backfillRecentDays(10).catch((err) => console.error('[screenToday] 回補失敗:', err.message));

  const days = loadAllDays();
  if (days.length < 80) {
    throw new Error(`快取資料只有 ${days.length} 個交易日，太少，請先跑完整回補`);
  }

  const universe = buildUniverse(days, { topN, minCoverage: 0.9 });
  const codes = universe.map((u) => u.code);
  const seriesMap = buildSeriesByCode(days, codes);
  for (const s of seriesMap.values()) annotateSeries(s);
  const sortedRet20ByDate = buildSortedRet20ByDate(seriesMap);

  const latestDate = days[days.length - 1].date;

  const technicalCandidates = [];
  for (const { code, name } of universe) {
    const series = seriesMap.get(code);
    if (!series || series.length < 80) continue;
    const last = series[series.length - 1];
    if (last.date !== latestDate) continue; // 該股今天無成交（停牌等），略過
    if (isEntrySignal(last, sortedRet20ByDate.get(latestDate), rsPercentile)) {
      technicalCandidates.push({ code, name, ret20: last.ret20, close: last.close });
    }
  }

  technicalCandidates.sort((a, b) => b.ret20 - a.ret20);
  const top = technicalCandidates.slice(0, maxResults);

  const [revenueMap, epsMap, warningSet, heavyInsiderSet] = await Promise.all([
    fetchRevenueGrowthMap().catch(() => new Map()),
    fetchEpsMap().catch(() => new Map()),
    fetchWarningCodeSet().catch(() => new Set()),
    fetchHeavyInsiderTransferCodeSet().catch(() => new Set()),
  ]);

  const enriched = top.map((c) => {
    const rev = revenueMap.get(c.code) || null;
    const eps = epsMap.get(c.code) || null;
    const flags = [];
    if (warningSet.has(c.code)) flags.push('注意股／處置股');
    if (heavyInsiderSet.has(c.code)) flags.push('近期內部人大幅申報轉讓');
    if (rev && rev.yoyGrowthPct != null && rev.yoyGrowthPct < 0) flags.push('月營收年增為負');
    if (eps && eps.epsBasic != null && eps.epsBasic < 0) flags.push('最近一季EPS為負');

    return { ...c, revenue: rev, eps, flags };
  });

  return {
    dataNote: dataSourceNote(days.slice(-80)),
    date: latestDate,
    universeSize: universe.length,
    totalSignals: technicalCandidates.length,
    candidates: enriched,
  };
}

module.exports = { screenToday };
