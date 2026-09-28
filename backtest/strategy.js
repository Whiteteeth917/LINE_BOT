// 把每個日期、全市場 20 日報酬率由小到大排序，用來算個股當天的相對強度百分位
// （沒有另外快取加權指數，用同一批股票池的橫斷面排名近似「有沒有跑贏大盤」）
function buildSortedRet20ByDate(seriesMap) {
  const byDate = new Map(); // date -> [ret20...]

  for (const series of seriesMap.values()) {
    for (const r of series) {
      if (r.ret20 == null) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date).push(r.ret20);
    }
  }

  const sortedByDate = new Map();
  for (const [date, arr] of byDate.entries()) {
    sortedByDate.set(date, [...arr].sort((a, b) => a - b));
  }
  return sortedByDate;
}

function percentileRank(sortedArr, val) {
  let lo = 0;
  let hi = sortedArr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedArr[mid] < val) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedArr.length;
}

// 回測調參找出來的預設門檻：20日報酬要排在股票池前 10%（百分位 >= 0.9），
// 且同時滿足「創20日新高」與「量能爆量」（比只滿足其一嚴格，訊號品質較高）。
const DEFAULT_RS_PERCENTILE = 0.9;

// 進場條件：站上季線且季線走揚、站上月線、相對強度夠強、且創20日新高與爆量同時成立
function isEntrySignal(row, sortedRet20, rsPercentile = DEFAULT_RS_PERCENTILE) {
  if (row.ma20 == null || row.ma60 == null || row.ma60Rising == null || row.ret20 == null || !sortedRet20) {
    return false;
  }
  const trendUp = row.close > row.ma20 && row.ma20 > row.ma60 && row.ma60Rising;
  const relativeStrength = percentileRank(sortedRet20, row.ret20) >= rsPercentile;
  const breakout = row.isHigh20 && row.volAvg20 != null && row.volume > 1.5 * row.volAvg20;
  return trendUp && relativeStrength && breakout;
}

module.exports = { buildSortedRet20ByDate, isEntrySignal, percentileRank, DEFAULT_RS_PERCENTILE };
