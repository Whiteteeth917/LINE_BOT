const { loadRecentDays } = require('./loadCache');
const { buildSeriesByCode } = require('./buildSeries');
const { annotateSeries } = require('./indicators');
const { buildSortedRet20ByDate, isEntrySignal } = require('./strategy');
const { calcPivotPoints, calcStopLoss } = require('../src/pivotPoints');
const { resolveCategory, getCodesByCategory, listCategories } = require('./sectorLookup');
const { fetchRecentInstitutionalFlow } = require('./institutionalFlow');
const {
  fetchRevenueGrowthMap,
  fetchEpsMap,
  fetchWarningCodeSet,
  fetchHeavyInsiderTransferCodeSet,
} = require('./fundamentals');

const STOP_LOSS_PCT = 20; // 跟 Bot 全站預設一致

// 給不熟股票的人用：輸入一個類股關鍵字，回傳這個類股裡目前的技術面狀態＋籌碼＋基本面＋異常標記，
// 不含任何題材故事（沒有新聞來源，不編造），進場區／目標皆為樞紐點客觀公式算出來的價位。
async function screenBySector(keyword) {
  const category = await resolveCategory(keyword);
  if (!category) {
    const categories = await listCategories();
    return { matched: false, categories };
  }

  const codes = await getCodesByCategory(category);

  // 只需要算到季線走揚（約 65 根K棒）＋過濾 80 根，讀最近 100 個交易日就夠，不必載入整份歷史
  const days = loadRecentDays(100);
  if (!days.length) throw new Error('行情資料還沒下載完成，請稍後再試');
  const seriesMap = buildSeriesByCode(days, codes);
  for (const s of seriesMap.values()) annotateSeries(s);
  const sortedRet20ByDate = buildSortedRet20ByDate(seriesMap);
  const latestDate = days[days.length - 1].date;
  const recentDates = days.slice(-5).map((d) => d.date);
  const nameMap = new Map(days[days.length - 1].rows.map((r) => [r.code, r.name]));

  const [revenueMap, epsMap, warningSet, heavyInsiderSet, flowMap] = await Promise.all([
    fetchRevenueGrowthMap().catch(() => new Map()),
    fetchEpsMap().catch(() => new Map()),
    fetchWarningCodeSet().catch(() => new Set()),
    fetchHeavyInsiderTransferCodeSet().catch(() => new Set()),
    fetchRecentInstitutionalFlow(recentDates).catch(() => new Map()),
  ]);

  const results = [];
  for (const code of codes) {
    const series = seriesMap.get(code);
    if (!series || series.length < 80) continue;
    const last = series[series.length - 1];
    if (last.date !== latestDate) continue;
    if (last.ma20 == null || last.ma60 == null) continue;

    const { pivot, r1, s1 } = calcPivotPoints({ high: last.high, low: last.low, close: last.close });
    const stopLoss = calcStopLoss(s1, STOP_LOSS_PCT);
    const signal = isEntrySignal(last, sortedRet20ByDate.get(latestDate));
    const trendUp = last.close > last.ma20 && last.ma20 > last.ma60 && last.ma60Rising;

    const rev = revenueMap.get(code) || null;
    const eps = epsMap.get(code) || null;
    const flags = [];
    if (warningSet.has(code)) flags.push('注意股／處置股');
    if (heavyInsiderSet.has(code)) flags.push('近期內部人大幅申報轉讓');
    if (rev && rev.yoyGrowthPct != null && rev.yoyGrowthPct < 0) flags.push('月營收年增為負');
    if (eps && eps.epsBasic != null && eps.epsBasic < 0) flags.push('最近一季EPS為負');

    results.push({
      code,
      name: nameMap.get(code) || code,
      close: last.close,
      ret20: last.ret20,
      trendUp,
      signal,
      pivot,
      resistance: r1,
      support: s1,
      stopLoss,
      revenue: rev,
      eps,
      flow: flowMap.get(code) || null,
      flags,
    });
  }

  // 有訊號的排前面，其次依 20 日報酬排序
  results.sort((a, b) => {
    if (a.signal !== b.signal) return a.signal ? -1 : 1;
    return (b.ret20 ?? -Infinity) - (a.ret20 ?? -Infinity);
  });

  return { matched: true, category, results: results.slice(0, 10), total: results.length, flowDays: flowMap.daysCovered || 0 };
}

module.exports = { screenBySector };
